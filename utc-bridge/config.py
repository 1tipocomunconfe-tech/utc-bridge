import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # URLs de Render
    PUBLISHER_API_URL: str = os.getenv("PUBLISHER_API_URL", "https://publicador-untipocomun.onrender.com")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://user:pass@host:port/dbname")

    # Seguridad
    BRIDGE_API_KEY: str = os.getenv("BRIDGE_API_KEY", "super-secret-key-123")

    # Configuración de Cloudinary (por si el bridge necesita validar URLs)
    CLOUDINARY_CLOUD_NAME: str = os.getenv("CLOUDINARY_CLOUD_NAME", "")

    class Config:
        env_file = ".env"

settings = Settings()
