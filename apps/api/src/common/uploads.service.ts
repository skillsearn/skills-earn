import { BadRequestException, Global, Injectable, Logger, Module } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from './supabase.service';

const BUCKET = 'uploads';
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };

/** Private image storage (Supabase Storage, service role). Files are only exposed through short-lived signed URLs. */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Accepts a `data:image/...;base64,...` URL and returns the stored object path. */
  async uploadImage(folder: string, dataUrl: string): Promise<string> {
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl ?? '');
    const ext = m && TYPES[m[1]];
    if (!m || !ext) throw new BadRequestException({ code: 'INVALID_IMAGE', message: 'Upload a PNG, JPG or WEBP image' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length === 0) throw new BadRequestException({ code: 'INVALID_IMAGE', message: 'The image is empty' });
    if (buf.length > MAX_BYTES) throw new BadRequestException({ code: 'IMAGE_TOO_LARGE', message: 'Image must be 5 MB or smaller' });

    const path = `${folder}/${Date.now()}-${randomUUID()}.${ext}`;
    const { error } = await this.supabase.db.storage.from(BUCKET).upload(path, buf, { contentType: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], upsert: false });
    if (error) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw new BadRequestException({ code: 'UPLOAD_FAILED', message: 'Could not store the image. Please try again.' });
    }
    return path;
  }

  async signedUrl(path: string | null | undefined, expiresIn = 3600): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.db.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error) {
      this.logger.warn(`Signed URL failed for ${path}: ${error.message}`);
      return null;
    }
    return data.signedUrl;
  }

  async remove(path: string | null | undefined) {
    if (path) await this.supabase.db.storage.from(BUCKET).remove([path]).catch(() => undefined);
  }
}

@Global()
@Module({ providers: [UploadsService], exports: [UploadsService] })
export class UploadsModule {}
