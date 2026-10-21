
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from database.db import engine, SessionLocal, Base, HealthCheck
import httpx
import asyncio
import time

app = FastAPI(title="API Health Monitor")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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


# Home endpoint
@app.get("/")
def home():
    return {
        "message": "API Health Monitor is running!",
        "status": "success"
    }


# Check a single URL
@app.get("/health")
async def check_health(
    url: str = Query(
        ...,
        description="Website URL to check"
    )
):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=400,
            detail="URL must start with http:// or https://"
        )

    start_time = time.perf_counter()

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True
        ) as client:
            response = await client.get(url)

        response_time = round(
            (time.perf_counter() - start_time) * 1000, 2
        )

        final_url = str(response.url)

        save_health_check(
            url=final_url,
            reachable=True,
            status_code=response.status_code,
            response_time_ms=response_time
        )

        return {
            "url": final_url,
            "reachable": True,
            "http_success": response.is_success,
            "status_code": response.status_code,
            "response_time_ms": response_time
        }

    except httpx.RequestError as error:
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
            "error": str(error),
            "response_time_ms": response_time
        }


# Request model for batch checks
class BatchHealthRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=10)


# Check multiple URLs concurrently
@app.post("/health/batch")
async def check_multiple_urls(request: BatchHealthRequest):

    async def check_one(url: str):
        if not url.startswith(("http://", "https://")):
            return {
                "url": url,
                "reachable": False,
                "error": "URL must start with http:// or https://"
            }

        start_time = time.perf_counter()

        try:
            async with httpx.AsyncClient(
                timeout=10.0,
                follow_redirects=True
            ) as client:
                response = await client.get(url)

            elapsed = round(
                (time.perf_counter() - start_time) * 1000, 2
            )

            final_url = str(response.url)

            save_health_check(
                url=final_url,
                reachable=True,
                status_code=response.status_code,
                response_time_ms=elapsed
            )

            return {
                "url": final_url,
                "reachable": True,
                "http_success": response.is_success,
                "status_code": response.status_code,
                "response_time_ms": elapsed
            }

        except httpx.RequestError as error:
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
                "error": str(error),
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
