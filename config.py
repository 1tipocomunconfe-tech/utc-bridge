import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # URLs de Render
    PUBLISHER_API_URL: str = os.getenv("PUBLISHER_API_URL", "https://publicador-untipocomun.onrender.com")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://user:pass@host:port/dbname")

    # Seguridad del Bridge (Para que el Productor se identifique ante el Bridge)
    BRIDGE_API_KEY: str = os.getenv("BRIDGE_API_KEY", "super-secret-key-123")

    # Seguridad del Publicador (Para que el Bridge se identifique ante el Publicador)
    PUBLISHER_API_KEY: str = os.getenv("PUBLISHER_API_KEY", "publisher-secret-key-456")

    # Configuración de Cloudinary
    CLOUDINARY_CLOUD_NAME: str = os.getenv("CLOUDINARY_CLOUD_NAME", "")

    class Config:
        env_file = ".env"

settings = Settings()
