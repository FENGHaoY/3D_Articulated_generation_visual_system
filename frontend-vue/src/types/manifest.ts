/** Loose shapes matching backend `result_manifest.json` + task payloads. */
export interface FileRef {
  url?: string;
  path?: string;
}

export interface ResultManifest {
  task_id?: string;
  status?: string;
  manifest_url?: string;
  meta_url?: string;
  input_image?: FileRef;
  mesh_files?: FileRef[];
  preview_files?: FileRef[];
  object_json_files?: FileRef[];
  raw_output_dir?: string;
  created_at?: string;
  finished_at?: string;
  joints_file?: FileRef | null;
  parts_file?: FileRef | null;
}

export interface TaskRecord {
  task_id?: string;
  status?: string;
  progress?: number;
  sample_urls?: string[];
  [key: string]: unknown;
}

export interface UploadResponse {
  upload_id?: string;
  file_url?: string;
  [key: string]: unknown;
}
