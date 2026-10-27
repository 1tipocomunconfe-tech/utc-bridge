import httpx
from config import settings

async def send_to_publisher(platform: str, video_url: str, caption: str, metadata: dict = None):
    """
    Envía la orden de publicación al Microservicio Publicador.
    """
    url = f"{settings.PUBLISHER_API_URL}/publish"

    payload = {
        "platform": platform,
        "video_url": video_url,
        "caption": caption,
        "metadata": metadata or {}
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(url, json=payload)
            if response.status_code in (200, 201, 202):
                print(f"✓ Publicación enviada exitosamente a {platform}")
                return {"success": True, "data": response.json()}
            else:
                print(f"❌ {platform} falló: {response.status_code} - {response.text}")
                return {"success": False, "error": f"Publisher returned {response.status_code}: {response.text}"}
    except Exception as e:
        print(f"❌ Error de conexión con el publicador ({platform}): {str(e)}")
        return {"success": False, "error": str(e)}
