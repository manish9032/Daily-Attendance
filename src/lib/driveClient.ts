import { DriveDocument } from '../types';
import { MAX_LOCKER_FILE_BYTES } from './compression';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

/**
 * Lists all documents created by this app in the student's Google Drive (`drive.file` scope).
 */
export async function listDriveDocuments(accessToken: string): Promise<DriveDocument[]> {
  const queryParams = new URLSearchParams({
    q: 'trashed = false',
    fields: 'files(id,name,mimeType,size,createdTime,webContentLink)',
    orderBy: 'createdTime desc',
    pageSize: '50',
  });

  const res = await fetch(`${DRIVE_FILES_API}?${queryParams.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('DRIVE_AUTH_EXPIRED');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to list Google Drive documents: ${errText}`);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      createdTime: string;
      webContentLink?: string;
    }>;
  };

  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size || 0),
    createdTime: f.createdTime,
    webContentLink: f.webContentLink,
  }));
}

/**
 * Uploads a compressed (< 200 KB) PDF or JPEG to the student's own Google Drive.
 */
export async function uploadDriveDocument(
  accessToken: string,
  blob: Blob,
  customName: string,
  mimeType: string,
  extension: 'jpg' | 'pdf'
): Promise<DriveDocument> {
  if (blob.size > MAX_LOCKER_FILE_BYTES) {
    throw new Error(
      `File exceeds the strict 200 KB limit (${(blob.size / 1024).toFixed(1)} KB).`
    );
  }

  const cleanBaseName = customName
    .trim()
    .replace(/\.(pdf|jpg|jpeg|png)$/i, '')
    .slice(0, 80);
  const finalFileName = `${cleanBaseName || 'Student_Document'}.${extension}`;

  const metadata = {
    name: finalFileName,
    mimeType,
    description: 'Stored via Daily Attendance Student Document Locker (<200KB optimized)',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', blob, finalFileName);

  const res = await fetch(
    `${DRIVE_UPLOAD_API}&fields=id,name,mimeType,size,createdTime,webContentLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: form,
    }
  );

  if (res.status === 401 || res.status === 403) {
    throw new Error('DRIVE_AUTH_EXPIRED');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload to Google Drive failed: ${errText}`);
  }

  const created = await res.json();
  return {
    id: created.id,
    name: created.name,
    mimeType: created.mimeType,
    size: Number(created.size || blob.size),
    createdTime: created.createdTime || new Date().toISOString(),
    webContentLink: created.webContentLink,
  };
}

/**
 * Downloads a document binary Blob from the student's Google Drive for viewing or saving locally.
 */
export async function fetchDriveDocumentBlob(
  accessToken: string,
  fileId: string
): Promise<Blob> {
  const res = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('DRIVE_AUTH_EXPIRED');
  }

  if (!res.ok) {
    throw new Error('Failed to fetch document content from Google Drive.');
  }

  return await res.blob();
}

/**
 * Renames an existing file in the student's Google Drive (`PATCH /drive/v3/files/{fileId}`).
 */
export async function renameDriveDocument(
  accessToken: string,
  fileId: string,
  newCustomName: string,
  currentFileName: string
): Promise<void> {
  const extMatch = currentFileName.match(/\.(pdf|jpg|jpeg|png)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const stripped = newCustomName
    .trim()
    .replace(/\.(pdf|jpg|jpeg|png)$/i, '')
    .slice(0, 80);
  const finalName = `${stripped || 'Document'}${ext}`;

  const res = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: finalName }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('DRIVE_AUTH_EXPIRED');
  }

  if (!res.ok) {
    throw new Error('Failed to rename document in Google Drive.');
  }
}

/**
 * Permanently deletes a file created by the app from the student's Google Drive.
 * Must only be called after explicit user confirmation in the UI.
 */
export async function deleteDriveDocument(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(`${DRIVE_FILES_API}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('DRIVE_AUTH_EXPIRED');
  }

  if (!res.ok) {
    throw new Error('Failed to delete document from Google Drive.');
  }
}
