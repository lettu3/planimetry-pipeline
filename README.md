# Deploy Actions - PlayCanvas a SFTP

Este repositorio contiene los scripts necesarios para automatizar el ciclo de compilación, descarga, modificación y despliegue de un proyecto de PlayCanvas mediante **GitHub Actions**. La idea principal es que cada vez que se modifique la configuración de despliegue (`deploy_config.json`), se dispare un workflow que ejecute secuencialmente 4 scripts para deployar el proyecto.

## 🚀 Flujo de Trabajo (Roadmap de Scripts)

El proceso de despliegue se divide en 5 scripts principales:

1. **`fetch_playcanvas.ts`** *(Implementado)*
   Se encarga de conectarse a la API de PlayCanvas, solicitar la compilación del proyecto (buscando la rama "main" o "master"), esperar a que termine el job y descargar el archivo `.zip` resultante con el build.

2. **`modify_build.ts`** *(Breve implementación incompleta)*
   Su objetivo es descomprimir el archivo `.zip` descargado, modificar los archivos propios del build según sea necesario (por ejemplo, rutas CDN, títulos HTML), y dejar la carpeta lista para subirla al servidor.

3. **`deploy_sftp.ts`** *(implementación incompleta)*
   Se conecta al servidor SFTP, realiza un wipe selectivo (protegiendo el `index.html` si es necesario) y sube los archivos del nuevo build generado a la ruta remota.

4. **`invalidate_cache.ts`** *(Aún no implementado)*
   Se encarga de conectarse a AWS y solicitar una invalidación en la distribución de CloudFront para asegurar que los usuarios reciban los nuevos assets inmediatamente, sin afectar el uptime.

5. **`log_deploy.ts`** *(Aún no implementado)*
   Llevará un registro del despliegue exitoso (o fallido) escribiendo los detalles en un archivo de log local o remoto.

---

## 🛠️ Requisitos Previos

Para correr estos scripts de manera local por primera vez, vas a necesitar:

- **Node.js** (v18 o superior recomendado)
- **Instalar las dependencias:**

  ```bash
  npm install
  ```

- **Archivo `.env`:** Crear un archivo llamado `.env` en la raíz del proyecto para definir tus variables de entorno privadas.

### Variables de Entorno

El proyecto usa `dotenv` para cargar secretos que no deben subirse al repositorio. Necesitarás el siguiente valor en tu `.env` u overrideado en tu sistema:

```env
PLAYCANVAS_API_KEY=tu_token_de_acceso_a_playcanvas

# Credenciales SFTP
SFTP_HOST=tu_servidor.com
SFTP_PORT=22
SFTP_USER=tu_usuario
SFTP_PASSWORD=tu_contraseña

# Credenciales AWS
AWS_ACCESS_KEY_ID=tu_access_key
AWS_SECRET_ACCESS_KEY=tu_secret_key
AWS_REGION=us-east-1
```

### Configuración (`deploy_config.json`)

Toda la configuración técnica sobre qué proyecto buildeo y a dónde lo subo, reside en el archivo `deploy_config.json`.
Cualquier cambio empujado a este archivo en la rama principal debería (a futuro) gatillar el flujo de **GitHub Actions**.

Ejemplo de estructura actual:

```json
{
    "playcanvas": {
        "project_id": 1316148,
        "project_name": "casa-foa",
        "target_branch_name": "master",
        "branch_id": ""
    },
    "html_modify": {
        "cdn_url": "https://dit9akr5f3nsa.cloudfront.net",
        "cloudfront_distribution_id": "E1XXXXXXX",
        "modify_indexhtml": false,
        "title": "Docta"
    },
    "sftp": {
        "remote_path": "/ruta/remota/"
    }
}
```

**Nota:** El remote_path está tipado estrictamente y siempre debe comenzar con html/.

---

## 🏃 Cómo Correr los Scripts Localmente

El proyecto utiliza TypeScript, ejecutándose de forma directa mediante `ts-node`. Para probar individualmente los scripts ya implementados:

### 1. Descargar el Build de PlayCanvas

```bash
npx ts-node src/fetch_playcanvas.ts
```

*(Esto va a leer `deploy_config.json`, conectarse a la API y descargar un `build.zip` localmente).*

### 2. Modificar el Build *(WIP)*

```bash
npx ts-node src/modify_build.ts
```

### 3. Subir via SFTP *(WIP)*

```bash
npx ts-node src/deploy_sftp.ts
```

*(Los scripts 4 y 5 se ejecutarán de la misma manera una vez implementados).*

---

## 🤖 GitHub Actions Workflow (Futuro)

La intención final del repositorio es no correr esto localmente salvo durante el desarrollo.

Se creará un flujo de trabajo (workflow) en `.github/workflows/` configurado para escuchar cambios (`on: push`) que incluyan el archivo `deploy_config.json`. Cuando detecte un cambio, el runner de GitHub ejecutará estos mismos 4 comandos en secuencia usando las variables de entorno guardadas como secretos (Secrets) del repositorio.
