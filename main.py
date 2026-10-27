from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel
import httpx
from config import settings
from core.strategy import get_platforms_for_pillar
from clients.publisher_client import send_to_publisher

app = FastAPI(title="UTC Bridge - Integración Productor-Publicador")

class TriggerRequest(BaseModel):
    reel_id: int

async def process_publishing_pipeline(reel_id: int):
    """
    Lógica central de integración:
    1. Obtener datos del Reel (DB)
    2. Determinar Plataformas (Strategy)
    3. Generar Captions (Logic)
    4. Despachar al Publicador
    """
    # 1. Obtener datos del Reel desde el Productor o DB
    # Para mantener la independencia, consultamos al Productor o la DB compartida
    # Aquí simulamos la obtención de datos
    reel_data = await fetch_reel_data(reel_id)
    if not reel_data:
        print(f"❌ Reel {reel_id} no encontrado")
        return

    video_url = reel_data.get("public_url") # La URL de Cloudinary
    pillar = reel_data.get("pilar")

    # 2. Determinar a qué redes va según el pilar
    platforms = get_platforms_for_pillar(pillar)
    print(f"🚀 Reel #{reel_id} ({pillar}) -> Publicando en: {platforms}")

    # 3. Generar captions optimizados
    # Aquí integramos la lógica que ya tenías en el CaptionEngine
    captions = generate_captions_for_platforms(reel_data, platforms)

    # 4. Enviar al publicador plataforma por plataforma
    for platform in platforms:
        caption = captions.get(platform, "Un Tipo Común")
        result = await send_to_publisher(platform, video_url, caption)
        if result["success"]:
            print(f"✅ {platform}: Publicación enviada exitosamente")
        else:
            print(f"❌ {platform}: Error -> {result['error']}")

async def fetch_reel_data(reel_id: int):
    """
    Consulta la base de datos compartida o la API del productor para obtener
    la URL de Cloudinary y el pilar.
    """
    # Implementación simplificada: Aquí iría la consulta a tu DB PostgreSQL
    # return db.query(Reel).filter(id=reel_id).first()
    return {
        "id": reel_id,
        "public_url": "https://res.cloudinary.com/demo/video/upload/reel.mp4",
        "pilar": "duelo_ruptura",
        "topic": "Cómo superar la ruptura"
    }

def generate_captions_for_platforms(reel_data: dict, platforms: list):
    """
    Lógica de generación de textos según la plataforma.
    """
    results = {}
    topic = reel_data.get("topic", "Reflexión")

    for p in platforms:
        if p == "tiktok":
            results[p] = f"🔥 {topic} #fyp #crecimiento #hombria"
        elif p == "instagram":
            results[p] = f"Reflexión del día: {topic}. Lee más en la descripción. 👇 #estocismo #disciplina"
        elif p == "youtube":
            results[p] = f"{topic} - Un Tipo Común"
        else:
            results[p] = f"{topic} #UnTipoComun"

    return results

@app.get("/")
async def root():
    return {"status": "online", "service": "UTC Bridge"}

@app.post("/trigger")
async def trigger_publication(request: TriggerRequest, x_api_key: str = Header(None), background_tasks: BackgroundTasks = BackgroundTasks()):
    # Validación de seguridad simple
    if x_api_key != settings.BRIDGE_API_KEY:
        raise HTTPException(status_code=403, detail="API Key inválida")

    # Ejecutamos la publicación en segundo plano para que el productor no tenga que esperar
    background_tasks.add_task(process_publishing_pipeline, request.reel_id)

    return {"status": "processing", "message": f"Proceso de publicación iniciado para el Reel #{request.reel_id}"}
