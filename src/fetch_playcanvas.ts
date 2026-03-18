import 'dotenv/config';
import type {
    PlayCanvasSceneListResponse,
    PlayCanvasAppDownloadRequest,
    PlayCanvasJobResponse,
    PlayCanvasBranchListResponse
} from 'playcanvas-api';

import * as fs from 'fs';
import * as path from 'path';

import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, '../deploy_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const API_KEY = process.env.PLAYCANVAS_API_KEY;

if (!API_KEY){
    console.error("Error: falta la variable de entorno PLAYCANVAS_API_KEY");
    process.exit(1);
}

const headers = {
    'Authorization' : `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

export async function fetchPlayCanvas(){
    try{
        console.log(`🔎 Buscando escenas para el proyecto ${config.playcanvas.project_id}...`);

        const scenesRes = await fetch(`https://playcanvas.com/api/projects/${config.playcanvas.project_id}/scenes`, { headers });
        if (!scenesRes.ok) throw new Error(`Error HTTP escenas: ${scenesRes.status}`);

        // Aplicamos la interfaz PlayCanvasSceneListResponse
        const scenesData = await scenesRes.json() as PlayCanvasSceneListResponse;
        
        if (!scenesData || !scenesData.result || scenesData.result.length === 0) {
            throw new Error("No se encontraron escenas en el proyecto.");
        }

        // 1. Buscamos si existe una escena llamada "Main" (ignorando mayúsculas/minúsculas)
        const mainScene = scenesData.result.find((s: any) => s.name.toLowerCase() === 'main');
        
        let sceneIds: number[] = [];

        if (mainScene) {
            console.log(`✅ Escena principal (Entrypoint) detectada: "${mainScene.name}" (ID: ${mainScene.id})`);
            
            // Filtramos las demás escenas para no duplicar la principal
            const otherScenes = scenesData.result.filter((s: any) => s.id !== mainScene.id);
            
            // Construimos el array: "Main" va PRIMERA en la lista, el resto atrás
            sceneIds = [mainScene.id, ...otherScenes.map((s: any) => s.id)];
        } else {
            console.warn(`⚠️ No se encontró una escena llamada "Main". Usando la primera devuelta por la API como principal.`);
            
            // Si no hay "Main", simplemente mapeamos todas. La [0] será el entrypoint por defecto.
            sceneIds = scenesData.result.map((s: any) => s.id);
        }

        console.log(`📦 Total de escenas a empaquetar: ${sceneIds.length}`);


        // --- NUEVO PASO: Obtener el branch_id correcto ---
        console.log(`🔎 Buscando branches (ramas) del proyecto...`);
        const branchesRes = await fetch(`https://playcanvas.com/api/projects/${config.playcanvas.project_id}/branches`, { headers });
        if (!branchesRes.ok) throw new Error(`Error HTTP branches: ${branchesRes.status}`);
        
        const branchesData = await branchesRes.json() as PlayCanvasBranchListResponse;
        if (!branchesData.result || branchesData.result.length === 0) {
            throw new Error("No se encontraron ramas (branches) en el proyecto.");
        }

        // Buscamos específicamente la rama que se llame "main" o "master"
        let targetBranch = branchesData.result.find((b: any) => 
            b.name.toLowerCase() === 'main' || b.name.toLowerCase() === 'master'
        );

        // Si no existe main/master, podés decidir qué hacer. Por ahora tiramos error para estar seguros.
        if (!targetBranch) {
            console.warn("⚠️ No se encontró la rama 'main' o 'master'. Las ramas disponibles son:");
            branchesData.result.forEach((b: any) => console.log(`   - ${b.name}`));
            throw new Error("Abortando: No hay rama principal disponible para compilar.");
        }

        const targetBranchId = targetBranch.id;
        console.log(`✅ Branch detectada: "${targetBranch.name}" (ID: ${targetBranchId})`);
        // ------------------------------------------------



        // 2. Solicitamos la generación del archivo .zip
        console.log("📤 Solicitando generación del archivo .zip...");      
        // Aplicamos la interfaz PlayCanvasAppDownloadRequest al payload
        const buildPayload: PlayCanvasAppDownloadRequest = {
            project_id: config.playcanvas.project_id,
            name: config.playcanvas.project_name,
            scenes: sceneIds,
            branch_id: targetBranchId, // Inyectamos el ID real de la rama
            scripts_concatenate: true,
        };

        const buildRes = await fetch('https://playcanvas.com/api/apps/download', {
            method: 'POST',
            headers,
            body: JSON.stringify(buildPayload)
        });
        if (!buildRes.ok) throw new Error(`Error HTTP build: ${buildRes.status}`);

        // Aplicamos la interfaz PlayCanvasJobResponse
        const buildData = await buildRes.json() as PlayCanvasJobResponse;
        const jobId = buildData.id;
        console.log(`✅ Job iniciado con ID: ${jobId}. Esperando compilación...`);


        // 3. Consultar estado del Job
        let downloadUrl = "";
        while (true) {
            const jobRes = await fetch(`https://playcanvas.com/api/jobs/${jobId}`, { headers });
            if (!jobRes.ok) throw new Error(`Error HTTP job: ${jobRes.status}`);
            
            // Aplicamos la misma interfaz PlayCanvasJobResponse para el chequeo
            const jobData = await jobRes.json() as PlayCanvasJobResponse;
            
            if (jobData.status === 'complete') {
                // TypeScript ahora sabe que data.download_url existe y es un string
                downloadUrl = jobData.data.download_url as string;
                console.log("✅ ¡Compilación terminada en los servidores!");
                break;
            } else if (jobData.status === 'error') {
                // Unimos todos los mensajes de error que PlayCanvas devuelva
                const detalles = jobData.messages && jobData.messages.length > 0 
                    ? jobData.messages.join('\n - ') 
                    : 'Sin detalles adicionales del servidor.';
                    
                throw new Error(`El build falló internamente en PlayCanvas.\nDetalles del error:\n - ${detalles}`);
            }
            
            console.log("⏳ Procesando... esperando 5 segundos.");
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // 4. Descargar el archivo .zip localmente
        console.log(`Iniciando descarga desde la URL generada...`);
        const zipRes = await fetch(downloadUrl);
        if (!zipRes.ok) throw new Error(`Error HTTP descarga: ${zipRes.status}`);
        
        const tempDir = path.resolve(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const zipPath = path.join(tempDir, 'build.zip');
        const fileStream = fs.createWriteStream(zipPath);
        
        if (zipRes.body) {
            await finished(Readable.fromWeb(zipRes.body as any).pipe(fileStream));
            console.log(`✅ Archivo guardado exitosamente como: ${zipPath}`);
        } else {
            throw new Error("La respuesta de descarga no contiene datos.");
        }

    } catch (error){
        console.error("Error: proceso interrumpido", error);
        process.exit(1);
    }
};


if (process.argv[1] === fileURLToPath(import.meta.url)) {
    fetchPlayCanvas();
}