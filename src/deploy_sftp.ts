import 'dotenv/config'
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Client from 'ssh2-sftp-client';
import type { DeployConfig } from 'deploy_config';
import { EventEmitter } from 'events';

EventEmitter.defaultMaxListeners = 50;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, '../deploy_config.json');
const distPath = path.resolve(__dirname, '../dist');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as DeployConfig;

// Validación en tiempo de ejecución
if (!config.sftp?.remote_path?.startsWith('html/')) {
    console.error("❌ Error de configuración: 'sftp.remote_path' DEBE comenzar con 'html/'");
    process.exit(1);
}


const {SFTP_HOST, SFTP_PORT,SFTP_USER, SFTP_PASSWORD,} = process.env;

console.log(SFTP_HOST, SFTP_PORT,SFTP_USER, SFTP_PASSWORD)
if (!SFTP_HOST || !SFTP_PORT || !SFTP_USER || !SFTP_PASSWORD){
    console.error("❌ Error: faltan variables de entorno para SFTP");
    process.exit(1);
}


// --- FUNCIONES AUXILIARES DE DIFFING ---

interface AssetMap {
    [filePath: string]: string; // URL del archivo -> Hash
}

// Extrae todos los hashes de archivos y variantes del config.json
function extractAssetHashes(configJson: any): AssetMap {
    const map: AssetMap = {};
    if (!configJson || !configJson.assets) return map;

    for (const key in configJson.assets) {
        const asset = configJson.assets[key];
        if (asset.file && asset.file.url && asset.file.hash) {
            let localPath = decodeURI(asset.file.url);
            // FIX 2: Parche para linked assets que PC exporta con URL de API en vez de ruta local
            if (localPath.startsWith('/api/')) {
                localPath = `files/assets/${key}/1/${asset.file.filename}`;
            }
            map[localPath] = asset.file.hash;

            // Procesar variantes (ej. .basis)
            if (asset.file.variants) {
                for (const vKey in asset.file.variants) {
                    const variant = asset.file.variants[vKey];
                    if (variant.url && variant.hash) {
                        map[variant.url] = variant.hash;
                    }
                }
            }
        }
    }
    return map;
}

// Obtiene todos los archivos locales como array plano
async function getLocalFiles(dir: string, baseDir: string = dir): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
            results.push(...await getLocalFiles(fullPath, baseDir));
        } else {
            results.push(relPath);
        }
    }
    return results;
}

// Obtiene archivos remotos NO ASSETS (Saltea la carpeta 'files' entera para máxima velocidad)
async function getRemoteNonAssetFiles(sftp: Client, dir: string, baseDir: string = dir): Promise<string[]> {
    const results: string[] = [];
    try {
        const entries = await sftp.list(dir);
        for (const entry of entries) {
            const fullPath = `${dir}/${entry.name}`;
            const relPath = fullPath.replace(`${baseDir}/`, '');

            if (entry.type === 'd') {
                // Magia: Evitamos iterar todo el árbol de assets de PlayCanvas
                if (relPath === 'files' || relPath.startsWith('files/')) continue;
                results.push(...await getRemoteNonAssetFiles(sftp, fullPath, baseDir));
            } else {
                results.push(relPath);
            }
        }
    } catch (error: any) {
        if (error.code !== 2) throw error; // 2 = no such file
    }
    return results;
}

// Controlador de concurrencia
async function processInBatches<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
    const executing = new Set<Promise<void>>();
    for (const item of items) {
        const p = fn(item).finally(() => executing.delete(p));
        executing.add(p);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);
}


export async function deploySFTP(){
    const sftp = new Client();
    try{
        console.log('🚀 Iniciando proceso de deploy vía SFTP...');

        if (!fs.existsSync(distPath)) {
            throw new Error(`No se encontró la carpeta local: ${distPath}. Asegúrate de correr el build primero.`);
        }

        const remotePath = config.sftp?.remote_path;
        if (!remotePath) {
            throw new Error("Falta definir 'sftp.remote_path' en deploy_config.json");
        }
        const cleanRemotePath = remotePath.replace(/\/+$/, '');
        console.log(`🔌 Conectando al servidor SFTP (${SFTP_HOST}:${SFTP_PORT || 22})...`);
        await sftp.connect({
            host: SFTP_HOST as string,
            port: SFTP_PORT ? parseInt(SFTP_PORT, 10) : 22,
            username: SFTP_USER as string,
            password: SFTP_PASSWORD as string,
        });

        console.log('✅ Conexión establecida con éxito.');

        // 1. Descargar config remoto y parsear hashes
        console.log(`🔎 Descargando config.json remoto...`);
        let remoteConfig = null;
        try {
            const remoteConfigBuffer = await sftp.get(`${cleanRemotePath}/config.json`);
            remoteConfig = JSON.parse(remoteConfigBuffer.toString('utf-8'));
            console.log("✅ config.json remoto obtenido.");
        } catch (e: any) {
            console.log("⚠️ No se encontró config.json remoto (Asumiendo primer deploy).");
        }
        const remoteAssetHashes = extractAssetHashes(remoteConfig);

        // 2. Parsear config local
        const localConfigPath = path.join(distPath, 'config.json');
        const localConfig = JSON.parse(await fs.promises.readFile(localConfigPath, 'utf-8'));
        const localAssetHashes = extractAssetHashes(localConfig);

        // 3. Obtener el resto del árbol de forma rápida
        console.log(`🔎 Analizando estructura (Omitiendo deep scan de red)...`);
        const [localFiles, remoteNonAssetFiles] = await Promise.all([
            getLocalFiles(distPath),
            getRemoteNonAssetFiles(sftp, cleanRemotePath)
        ]);

        const toUpload: string[] = [];
        const toDelete: string[] = [];

        // --- CALCULAR SUBIDAS ---
        for (const relPath of localFiles) {
            if (relPath.startsWith('files/')) {
                const localHash = localAssetHashes[relPath];
                const remoteHash = remoteAssetHashes[relPath];

                // Si es un archivo de asset pero su hash difiere, o es nuevo, o no está indexado, se sube.
                if (!localHash || !remoteHash || localHash !== remoteHash) {
                    toUpload.push(relPath);
                }
            } else {
                // Código, HTML y CSS siempre se suben para asegurar que esté actualizado (pesan KB)
                toUpload.push(relPath);
            }
        }

        // --- CALCULAR BORRADOS (HUÉRFANOS) ---
        // Assets que existen en el config remoto pero ya no en el local
        for (const relPath in remoteAssetHashes) {
            if (!localAssetHashes[relPath]) {
                toDelete.push(relPath);
            }
        }
        // Archivos de código/raíz que existen en remoto pero ya no en local
        for (const relPath of remoteNonAssetFiles) {
            if (!localFiles.includes(relPath)) {
                if (relPath === 'index.html') continue; // Proteger index
                toDelete.push(relPath);
            }
        }

        console.log(`📊 Resultado del Diffing: ${toUpload.length} para subir | ${toDelete.length} para eliminar.`);

// --- EJECUCIÓN ---
        if (toDelete.length > 0) {
            console.log(`🧹 Eliminando ${toDelete.length} archivos obsoletos...`);
            await processInBatches(toDelete, 10, async (relPath) => {
                const remoteFilePath = `${cleanRemotePath}/${relPath}`;
                await sftp.delete(remoteFilePath).catch(() => {}); // Ignorar si ya fue borrado
                console.log(`🗑️📄 Eliminado: ${relPath}`);
            });
        }

        if (toUpload.length > 0) {
            console.log(`📤 Subiendo ${toUpload.length} archivos...`);
            const startTime: Date = new Date();
            const createdDirs = new Map<string, Promise<void>>(); // Map de promesas para evitar race conditions

            const ensureRemoteDir = async (dir: string) => {
                // Eliminamos la línea que bloqueaba la creación del cleanRemotePath
                
                if (createdDirs.has(dir)) return createdDirs.get(dir);
            
                const promise = (async () => {
                    const exists = await sftp.exists(dir);
                    if (!exists) {
                        const parentDir = dir.substring(0, dir.lastIndexOf('/'));
                        if (parentDir && parentDir !== dir) {
                            await ensureRemoteDir(parentDir);
                        }
                        console.log(`📁 Creando carpeta remota: ${dir}`);
                        await sftp.mkdir(dir, true);
                    }
                })();
            
                createdDirs.set(dir, promise);
                return promise;
            };
            // Asegurar que la carpeta base remota existe (para el primer deploy)
            await ensureRemoteDir(cleanRemotePath);

            await processInBatches(toUpload, 10, async (relPath) => {
                const localFilePath = path.join(distPath, relPath);
                const remoteFilePath = `${cleanRemotePath}/${relPath}`;
                
                // Extraer el directorio relativo para manejar subcarpetas
                const lastSlashIndex = relPath.lastIndexOf('/');
                if (lastSlashIndex !== -1) {
                    const relDir = relPath.substring(0, lastSlashIndex);
                    const remoteFileDir = `${cleanRemotePath}/${relDir}`;
                    await ensureRemoteDir(remoteFileDir);
                }

                await sftp.fastPut(localFilePath, remoteFilePath);
                console.log(`✔️  Subido: ${relPath}`);
            });
            const timeDiff = new Date().getTime() - startTime.getTime();
            console.log(`✅ Subida completada. Tiempo de transferencia: ${timeDiff / 1000} segundos`);
        } else {
            console.log(`✅ Los servidores ya están sincronizados. Nada que subir.`);
        }
    } catch (error){
        console.error("❌ Error durante el deploy SFTP:", error);
        process.exit(1);
    } finally {
        try{
            await sftp.end();
            console.log("✅ Conexión SFTP cerrada correctamente");
        } catch (error){
            console.error("❌ Error: No se pudo cerrar la conexión SFTP", error);
        }
    }
}


if (process.argv[1] === fileURLToPath(import.meta.url)) {
    deploySFTP();
}