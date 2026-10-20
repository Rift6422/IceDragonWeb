/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FB_PIXEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
