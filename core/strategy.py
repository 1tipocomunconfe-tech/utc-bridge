# Matriz de Distribución Estratégica
# Define a qué plataformas se envía el contenido según el pilar del video.

STRATEGY_MAP = {
    # Pilares de Atracción (Growth) -> Casi todas las redes
    "duelo_ruptura": ["tiktok", "instagram", "youtube", "facebook"],
    "mentalidad_acero_cero_contacto": ["tiktok", "instagram", "youtube", "facebook"],
    "soledad_silencio": ["tiktok", "instagram", "youtube", "facebook"],
    "oscuridad_resiliencia_fuego_interior": ["tiktok", "instagram", "youtube", "facebook"],
    "desintoxicacion_emocional_cierre": ["tiktok", "instagram", "youtube", "facebook"],

    # Pilares de Autoridad (Trust) -> Enfoque en IG, YT y Pinterest
    "hombria_caracter": ["instagram", "youtube", "pinterest"],
    "fe_dios": ["instagram", "youtube", "facebook", "pinterest"],
    "dignidad_orgullo_limites": ["instagram", "youtube", "pinterest"],
    "metamorfosis_poder_version_final": ["instagram", "youtube", "pinterest"],
    "soberania_personal_libertad": ["instagram", "youtube", "pinterest"],

    # Pilares de Retención (Community) -> Enfoque en IG y FB
    "superacion_trabajo": ["instagram", "facebook"],
    "cuerpo_hierro_renacimiento": ["instagram", "facebook", "tiktok"],
    "autoestima_desapego_emocional": ["instagram", "facebook"],
    "ambicion_trabajo_proposito": ["instagram", "facebook"],
    "redireccion_energia_exceso": ["instagram", "facebook"],
}

def get_platforms_for_pillar(pillar: str) -> list[str]:
    """Retorna la lista de plataformas según el pilar, o un default si no existe."""
    return STRATEGY_MAP.get(pillar, ["instagram", "youtube"]) # Default seguro
