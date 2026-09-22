# Invest AI

Proyecto de análisis y gestión de inversiones impulsado por Inteligencia Artificial y la infraestructura de Google Cloud.

## Infraestructura en Google Cloud
- **Proyecto GCP:** `invest-ai-509415`
- **Servicios Principales:** BigQuery, Cloud Storage, APIs de Datos e Inteligencia Artificial.

## Configuración del Entorno
1. Clonar el repositorio.
2. Copiar `.env.example` a `.env` y configurar las variables requeridas.
3. Asegurar la autenticación en Google Cloud:
   ```bash
   gcloud auth login
   gcloud config set project invest-ai-509415
   ```
