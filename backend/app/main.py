from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import router
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title="EduFlow LMS API", version="0.2.0")
    origins = list(dict.fromkeys(settings.cors_origins + settings.auth_allowed_origins))
    if origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["GET", "POST"],
            allow_headers=["Accept", "Content-Type", "Authorization", "X-CSRF-Token"],
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        # Pydantic's default JSON error includes submitted credentials as `input`.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {key: item[key] for key in ("type", "loc", "msg")} for item in error.errors()
                ]
            },
        )

    application.include_router(router)
    return application
