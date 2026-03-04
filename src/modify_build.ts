import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, '../deploy_config.json');
const zipPath = path.resolve(__dirname, 'build.zip');
const distPath = path.resolve(__dirname, '../dist');

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

function modifyBuild(){
    try {
        console.log('🏗️ Iniciando proceso de modificación del build...');

        if (!fs.existsSync(zipPath)) {
            throw new Error("No se encontró build.zip. Asegúrate de correr fetch_playcanvas.ts primero.");
        }

        if (fs.existsSync(distPath)) {
            console.log(`🗑️ Limpiando carpeta dist anterior...`);
            fs.rmSync(distPath, { recursive: true, force: true });
        }

        console.log(`📦➡️📂 Extrayendo archivos...`);
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(distPath, true);
        console.log(`✅ Archivos extraídos en: ${distPath}`);


        const indexPath = path.join(distPath, 'index.html');
        if (!fs.existsSync(indexPath)) {
            throw new Error("No se encontró index.html dentro del archivo extraído.");
        }

        const mods = config.html_modify;
        if (mods && mods.modify_indexhtml){

        } else {
            console.log(`\n⏩ Modificaciones HTML deshabilitadas en el config. Omitiendo paso.`);
        }


        
    } catch (error){
        console.error("❌ Error: proceso interrumpido", error);
        process.exit(1);
    }
}

modifyBuild();

