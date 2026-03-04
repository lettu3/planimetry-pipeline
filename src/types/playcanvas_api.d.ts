declare module "playcanvas-api" {

    export interface PlayCanvasJobResponse {
        id: number;
        created_at: string;
        updated_at: string;
        status: 'running' | 'complete' | 'error';
        messages: string[];
        data: PlayCanvasJobData;
    }

    export interface PlayCanvasJobData {
        download_url?: string;
        app_id?: number;
        [key:string]: any;
    }


    export interface PlayCanvasAppResponse {
        id: number;
        project_id: number;
        name: string;
        description: string;
        app_url: string;
        download_url?: string;
        branch_id?: string;
        created_at: string;
        thumbnails?: {
            s: string;
            m: string;
            l: string;
            xl: string;
        };
    }

    
    export interface PlayCanvasSceneListResponse {
        result: PlayCanvasScene[];
    }

    export interface PlayCanvasScene {
        id: number;
        projectId: number;
        name: string;
        created: string;
        modified: string; 
    }


    export interface PlayCanvasAppDownloadRequest {
        project_id: number;
        name: string;
        scenes: number[];
        branch_id?: string;
        description?: string;
        version?: string;
        scripts_concatenate?: boolean;
        scripts_minify?: boolean;
        scripts_sourcemaps?: boolean;
        optimize_scene_format?: boolean;
    }

    export interface PlayCanvasBranchListResponse {
        result: PlayCanvasBranch[];
    }

    export interface PlayCanvasBranch {
        id: string;
        name: string;
        created_at: string;
    }

}