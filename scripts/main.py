
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from database.db import engine, SessionLocal, Base, HealthCheck
from sqlalchemy import text
import httpx
import asyncio
import ipaddress
import os
import socket
import time
from urllib.parse import urljoin, urlsplit

app = FastAPI(title="API Health Monitor")
MAX_REDIRECTS = 5
MAX_CONCURRENT_CHECKS = 5
frontend_origins = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,https://api-pulse-peach.vercel.app",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip().rstrip("/")
        for origin in frontend_origins.split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create database tables
Base.metadata.create_all(bind=engine)


# Save a health check to SQLite
def save_health_check(
    url: str,
    reachable: bool,
    status_code: int | None,
    response_time_ms: float | None
):
    db = SessionLocal()

    try:
        record = HealthCheck(
            url=url,
            reachable=reachable,
            status_code=status_code,
            response_time_ms=response_time_ms
        )

        db.add(record)
        db.commit()
        db.refresh(record)

        return record.id

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()


def validate_url_syntax(url: str) -> str:
    if len(url) > 2048:
        raise HTTPException(status_code=400, detail="URL must be 2048 characters or fewer.")

    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Enter a valid HTTP or HTTPS URL.") from error

    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise HTTPException(
            status_code=400,
            detail="Enter a valid public HTTP or HTTPS URL without embedded credentials.",
        )

    return parsed.hostname


async def validate_public_destination(url: str) -> None:
    hostname = validate_url_syntax(url)

    try:
        literal_address = ipaddress.ip_address(hostname)
        addresses = [literal_address]
    except ValueError:
        try:
            results = await asyncio.to_thread(
                socket.getaddrinfo,
                hostname,
                None,
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror as error:
            raise httpx.ConnectError("The domain could not be resolved.") from error
        addresses = [
            ipaddress.ip_address(result[4][0].split("%", 1)[0])
            for result in results
        ]

    if not addresses or any(
        not address.is_global
        or (address.ipv4_mapped is not None and not address.ipv4_mapped.is_global)
        for address in addresses
    ):
        raise HTTPException(
            status_code=400,
            detail="Checks are only allowed for publicly routable website addresses.",
        )


async def request_public_url(url: str) -> tuple[str, int, float]:
    start_time = time.perf_counter()
    current_url = url
    visited_urls = set()
    last_url = url
    last_status = 310

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(10.0, connect=3.0),
        follow_redirects=False,
        trust_env=False,
    ) as client:
        for redirect_count in range(MAX_REDIRECTS + 1):
            await validate_public_destination(current_url)
            if current_url in visited_urls:
                break
            visited_urls.add(current_url)

            async with client.stream("GET", current_url) as response:
                last_url = str(response.url)
                last_status = response.status_code
                if (
                    response.status_code not in (301, 302, 303, 307, 308)
                    or not response.headers.get("location")
                    or redirect_count == MAX_REDIRECTS
                ):
                    response_time = round(
                        (time.perf_counter() - start_time) * 1000, 2
                    )
                    return last_url, last_status, response_time

                current_url = urljoin(
                    str(response.url), response.headers["location"]
                )

    response_time = round((time.perf_counter() - start_time) * 1000, 2)
    return last_url, last_status, response_time


# Home endpoint
@app.get("/")
def home():
    return {
        "message": "API Health Monitor is running!",
        "status": "success"
    }


@app.get("/ready")
def readiness():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as error:
        raise HTTPException(status_code=503, detail="Database is unavailable.") from error

    return {"status": "ready"}


# Check a single URL
@app.get("/health")
async def check_health(
    url: str = Query(
        ...,
        description="Website URL to check"
    )
):
    validate_url_syntax(url)

    start_time = time.perf_counter()

    try:
        final_url, status_code, response_time = await request_public_url(url)

        save_health_check(
            url=final_url,
            reachable=True,
            status_code=status_code,
            response_time_ms=response_time
        )

        return {
            "url": final_url,
            "reachable": True,
            "http_success": 200 <= status_code < 300,
            "status_code": status_code,
            "response_time_ms": response_time
        }

    except httpx.RequestError:
        response_time = round(
            (time.perf_counter() - start_time) * 1000, 2
        )

        save_health_check(
            url=url,
            reachable=False,
            status_code=None,
            response_time_ms=response_time
        )

        return {
            "url": url,
            "reachable": False,
            "error": "The website could not be reached. Check its address or try again later.",
            "response_time_ms": response_time
        }


# Request model for batch checks
class BatchHealthRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=10)


# Check multiple URLs concurrently
@app.post("/health/batch")
async def check_multiple_urls(request: BatchHealthRequest):
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_CHECKS)

    async def check_one(url: str):
        try:
            validate_url_syntax(url)
        except HTTPException as error:
            return {
                "url": url,
                "reachable": False,
                "error": error.detail,
            }

        start_time = time.perf_counter()

        try:
            async with semaphore:
                final_url, status_code, elapsed = await request_public_url(url)

            save_health_check(
                url=final_url,
                reachable=True,
                status_code=status_code,
                response_time_ms=elapsed
            )

            return {
                "url": final_url,
                "reachable": True,
                "http_success": 200 <= status_code < 300,
                "status_code": status_code,
                "response_time_ms": elapsed
            }

        except HTTPException as error:
            return {
                "url": url,
                "reachable": False,
                "error": error.detail,
            }
        except httpx.RequestError:
            elapsed = round(
                (time.perf_counter() - start_time) * 1000, 2
            )

            save_health_check(
                url=url,
                reachable=False,
                status_code=None,
                response_time_ms=elapsed
            )

            return {
                "url": url,
                "reachable": False,
                "error": "The website could not be reached. Check its address or try again later.",
                "response_time_ms": elapsed
            }

    results = await asyncio.gather(
        *(check_one(url) for url in request.urls)
    )

    return {
        "total_urls": len(results),
        "results": results
    }


# View recent health-check history
@app.get("/health/history")
def get_health_history(
    limit: int = Query(default=20, ge=1, le=100)
):
    db = SessionLocal()

    try:
        records = (
            db.query(HealthCheck)
            .order_by(HealthCheck.id.desc())
            .limit(limit)
            .all()
        )

        return {
            "total_records": len(records),
            "history": [
                {
                    "id": record.id,
                    "url": record.url,
                    "reachable": record.reachable,
                    "status_code": record.status_code,
                    "response_time_ms": record.response_time_ms,
                    "checked_at": record.checked_at
                }
                for record in records
            ]
        }

    finally:
        db.close()


@app.delete("/health/history")
def delete_health_history():
    db = SessionLocal()

    try:
        deleted_records = db.query(HealthCheck).delete(synchronize_session=False)
        db.commit()
        return {"deleted_records": deleted_records}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
