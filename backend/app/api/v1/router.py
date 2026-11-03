from fastapi import APIRouter

from app.api.v1.admin_courses import router as admin_courses_router
from app.api.v1.auth import router as auth_router
from app.api.v1.courses import router as courses_router
from app.api.v1.health import router as health_router
from app.api.v1.instructor_courses import router as instructor_courses_router
from app.api.v1.users import router as users_router

router = APIRouter(prefix="/api/v1")
router.include_router(health_router)
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(courses_router)
router.include_router(instructor_courses_router)
router.include_router(admin_courses_router)
