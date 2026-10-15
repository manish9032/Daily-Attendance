import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CloudUpload,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderLock,
  Image as ImageIcon,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { DriveDocument } from '../types';
import {
  compressDocumentForLocker,
  formatBytesKB,
} from '../lib/compression';
import {
  deleteDriveDocument,
  fetchDriveDocumentBlob,
  listDriveDocuments,
  renameDriveDocument,
  uploadDriveDocument,
} from '../lib/driveClient';

interface DocumentLockerViewProps {
  accessToken: string | null;
  onReconnectDrive: () => Promise<string | null>;
  /** True while the app is connecting to Google Drive in the background. */
  isConnecting?: boolean;
}

const PRESET_DOC_NAMES = [
  'Class 10 Marksheet',
  'Class 12 Marksheet',
  'Board Exam Admit Card',
  'Aadhaar ID Proof',
  'School Transfer Certificate',
];

export const DocumentLockerView: React.FC<DocumentLockerViewProps> = ({
  accessToken,
  onReconnectDrive,
  isConnecting = false,
}) => {
  const [documents, setDocuments] = useState<DriveDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(!accessToken);

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [uploadStepText, setUploadStepText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Viewer modal state
  const [viewingDoc, setViewingDoc] = useState<DriveDocument | null>(null);
  const [viewerBlobUrl, setViewerBlobUrl] = useState<string | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(false);

  // Rename confirmation modal state
  const [docToRename, setDocToRename] = useState<DriveDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);

  // Delete confirmation modal state (Mandatory per workspace-integration skill)
  const [docToDelete, setDocToDelete] = useState<DriveDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadFiles = useCallback(async (tokenToUse: string | null) => {
    if (!tokenToUse) {
      setNeedsReauth(true);
      return;
    }

    setLoadingDocs(true);
    setErrorMsg(null);
    try {
      const files = await listDriveDocuments(tokenToUse);
      setDocuments(files);
      setNeedsReauth(false);
    } catch (err) {
      if (err instanceof Error && err.message === 'DRIVE_AUTH_EXPIRED') {
        setNeedsReauth(true);
      } else {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Unable to load documents from your Google Drive.'
        );
      }
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    if (accessToken) {
      setNeedsReauth(false);
      loadFiles(accessToken);
    } else {
      setNeedsReauth(true);
    }
  }, [accessToken, loadFiles]);

  // Revoke object URL on viewer close
  useEffect(() => {
    return () => {
      if (viewerBlobUrl) {
        URL.revokeObjectURL(viewerBlobUrl);
      }
    };
  }, [viewerBlobUrl]);

  const handleConnectDriveClick = async () => {
    const newToken = await onReconnectDrive();
    if (newToken) {
      await loadFiles(newToken);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setUploadError(null);
    if (file && !customName.trim()) {
      const base = file.name.replace(/\.(pdf|jpg|jpeg|png|webp)$/i, '');
      setCustomName(base);
    }
  };

  const handleCompressAndUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !customName.trim()) return;

    let token = accessToken;
    if (!token) {
      token = await onReconnectDrive();
      if (!token) return;
    }

    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(10);
    setUploadStepText('Starting < 200 KB optimization...');

    try {
      const compressed = await compressDocumentForLocker(
        selectedFile,
        (pct, status) => {
          setUploadProgress(Math.min(85, pct));
          setUploadStepText(status);
        }
      );

      setUploadProgress(90);
      setUploadStepText(
        `Uploading ${formatBytesKB(compressed.compressedSize)} file to your Google Drive...`
      );

      const created = await uploadDriveDocument(
        token,
        compressed.blob,
        customName.trim(),
        compressed.mimeType,
        compressed.extension
      );

      setDocuments((prev) => [created, ...prev]);
      setUploadProgress(100);
      setIsUploadOpen(false);
      setSelectedFile(null);
      setCustomName('');
    } catch (err) {
      if (err instanceof Error && err.message === 'DRIVE_AUTH_EXPIRED') {
        setNeedsReauth(true);
        setUploadError('Your Google Drive session expired. Please reconnect and try again.');
      } else {
        setUploadError(
          err instanceof Error
            ? err.message
            : 'Failed to compress and upload document under 200 KB.'
        );
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleOpenViewer = async (docItem: DriveDocument) => {
    let token = accessToken;
    if (!token) {
      token = await onReconnectDrive();
      if (!token) return;
    }

    setViewingDoc(docItem);
    setLoadingViewer(true);
    if (viewerBlobUrl) {
      URL.revokeObjectURL(viewerBlobUrl);
      setViewerBlobUrl(null);
    }

    try {
      const blob = await fetchDriveDocumentBlob(token, docItem.id);
      const url = URL.createObjectURL(blob);
      setViewerBlobUrl(url);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to preview document.'
      );
      setViewingDoc(null);
    } finally {
      setLoadingViewer(false);
    }
  };

  const handleDownloadToPhone = async (docItem: DriveDocument) => {
    let token = accessToken;
    if (!token) {
      token = await onReconnectDrive();
      if (!token) return;
    }

    try {
      const blob = await fetchDriveDocumentBlob(token, docItem.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = docItem.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to download document to your device.'
      );
    }
  };

  const handleConfirmRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docToRename || !renameValue.trim()) return;

    let token = accessToken;
    if (!token) {
      token = await onReconnectDrive();
      if (!token) return;
    }

    setIsRenaming(true);
    try {
      await renameDriveDocument(token, docToRename.id, renameValue.trim(), docToRename.name);
      await loadFiles(token);
      setDocToRename(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to rename document.'
      );
    } finally {
      setIsRenaming(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!docToDelete) return;

    let token = accessToken;
    if (!token) {
      token = await onReconnectDrive();
      if (!token) return;
    }

    setIsDeleting(true);
    try {
      await deleteDriveDocument(token, docToDelete.id);
      setDocuments((prev) => prev.filter((d) => d.id !== docToDelete.id));
      setDocToDelete(null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to delete document.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header Card */}
      <div className="rounded-3xl bg-white border border-[#E2E8E0] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#111C18]">
            Free Cloud Document Locker
          </h2>
          <p className="mt-0.5 text-xs text-[#52635B]">
            Marksheets, ID proofs, and admission PDFs are automatically compressed under 200 KB and saved strictly in your own Google Drive.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {!needsReauth && (
            <button
              type="button"
              onClick={() => loadFiles(accessToken)}
              className="min-h-[44px] min-w-[44px] rounded-xl border border-[#E2E8E0] flex items-center justify-center text-[#52635B] hover:bg-slate-50 transition-colors"
              aria-label="Refresh Drive documents"
            >
              <RefreshCw className={`w-4 h-4 ${loadingDocs ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setUploadError(null);
              setIsUploadOpen(true);
            }}
            className="min-h-[44px] px-4 rounded-xl bg-[#16A34A] hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <CloudUpload className="w-4 h-4" />
            <span>Upload Document</span>
          </button>
        </div>
      </div>

      {/* Google Drive connection state */}
      {needsReauth && isConnecting ? (
        <div className="rounded-3xl bg-white border border-[#E2E8E0] px-6 py-12 sm:py-14 text-center max-w-lg mx-auto">
          <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin mx-auto" />
          <h3 className="mt-5 text-lg font-bold text-[#111C18]">Connecting to Google Drive</h3>
          <p className="mt-2 text-sm text-[#52635B]">This only takes a moment.</p>
        </div>
      ) : needsReauth ? (
        <div className="rounded-3xl bg-white border border-[#E2E8E0] px-6 py-10 sm:px-10 sm:py-12 text-center max-w-lg mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto">
            <FolderLock className="w-7 h-7" />
          </div>
          <h3 className="mt-5 text-xl font-bold text-[#111C18]">Connect Google Drive</h3>
          <p className="mt-3 text-sm text-[#52635B] max-w-sm mx-auto">
            You are already signed in. Drive needs its own permission, and Google asks for it again after an hour or when the app reopens. Your files stay in your Drive, and the app only sees files it creates.
          </p>
          <div className="mt-7 flex justify-center">
            <button
              type="button"
              onClick={handleConnectDriveClick}
              className="gsi-material-button"
            >
              <div className="gsi-material-button-state"></div>
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    ></path>
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    ></path>
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    ></path>
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    ></path>
                    <path fill="none" d="M0 0h48v48H0z"></path>
                  </svg>
                </div>
                <span className="gsi-material-button-contents">Connect Google Drive</span>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <>
          {errorMsg && (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-xs text-red-800 flex items-center justify-between gap-3">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-red-600 font-semibold"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Document List */}
          <div className="rounded-3xl bg-white border border-[#E2E8E0] divide-y divide-[#E2E8E0] overflow-hidden">
            {loadingDocs ? (
              <div className="p-10 text-center">
                <RefreshCw className="w-7 h-7 text-emerald-600 animate-spin mx-auto mb-2" />
                <p className="text-sm font-semibold text-[#111C18]">
                  Loading documents from your Google Drive...
                </p>
              </div>
            ) : documents.length === 0 ? (
              <div className="p-10 text-center">
                <FolderLock className="w-8 h-8 text-[#52635B] mx-auto mb-2 opacity-60" />
                <p className="text-sm font-bold text-[#111C18]">
                  Your Document Locker is empty
                </p>
                <p className="text-xs text-[#52635B] mt-1 max-w-md mx-auto">
                  Upload your Class 10/12 marksheets, admit cards, or ID proofs. Every file is compressed under 200 KB and stored privately in your Google Drive.
                </p>
              </div>
            ) : (
              documents.map((docItem) => {
                const isPdf = docItem.mimeType.includes('pdf') || docItem.name.toLowerCase().endsWith('.pdf');
                const formattedDate = docItem.createdTime
                  ? new Date(docItem.createdTime).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'Saved in Drive';

                return (
                  <div
                    key={docItem.id}
                    className="p-4 sm:px-6 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isPdf
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {isPdf ? (
                          <FileText className="w-5 h-5" />
                        ) : (
                          <ImageIcon className="w-5 h-5" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#111C18] truncate">
                          {docItem.name}
                        </h3>
                        {/* Unboxed Metadata with · separators */}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#52635B]">
                          <span>{isPdf ? 'PDF Document' : 'JPEG Image'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular font-semibold text-emerald-800">
                            {formatBytesKB(docItem.size)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formattedDate}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenViewer(docItem)}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-[#111C18] hover:bg-slate-100 transition-colors"
                        title="View inside app"
                        aria-label={`View ${docItem.name}`}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadToPhone(docItem)}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-emerald-700 hover:bg-emerald-50 transition-colors"
                        title="Download to phone"
                        aria-label={`Download ${docItem.name}`}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDocToRename(docItem);
                          setRenameValue(
                            docItem.name.replace(/\.(pdf|jpg|jpeg|png)$/i, '')
                          );
                        }}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-[#52635B] hover:bg-slate-100 transition-colors"
                        title="Rename document"
                        aria-label={`Rename ${docItem.name}`}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDocToDelete(docItem)}
                        className="min-h-[44px] min-w-[44px] rounded-xl flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete document"
                        aria-label={`Delete ${docItem.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Upload & <200KB Compression Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
          <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white border border-[#E2E8E0] p-5 sm:p-6 shadow-xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8E0]">
              <div>
                <h3 className="text-lg font-bold text-[#111C18]">
                  Upload to Google Drive Locker
                </h3>
                <p className="text-xs text-[#52635B]">
                  Automatically compressed to &le; 200 KB before upload
                </p>
              </div>
              <button
                type="button"
                disabled={isUploading}
                onClick={() => setIsUploadOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#52635B] hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCompressAndUpload} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#111C18] mb-1">
                  Select PDF or JPEG / PNG File
                </label>
                <input
                  type="file"
                  required
                  accept=".pdf,image/jpeg,image/jpg,image/png"
                  onChange={handleFileChange}
                  className="w-full text-xs text-[#52635B] file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white hover:file:bg-slate-800"
                />
                {selectedFile && (
                  <p className="mt-1.5 text-xs font-mono-tabular text-[#52635B]">
                    Selected: {selectedFile.name} ({formatBytesKB(selectedFile.size)})
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#111C18] mb-1">
                  Custom Document Name
                </label>
                <input
                  type="text"
                  required
                  maxLength={80}
                  placeholder="e.g., Class 10 Board Marksheet"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3.5 text-sm text-[#111C18]"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PRESET_DOC_NAMES.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCustomName(preset)}
                      className="px-2.5 py-1 rounded-lg border border-[#E2E8E0] bg-[#F8FAF7] hover:bg-slate-100 text-xs font-medium text-[#111C18] transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {isUploading && (
                <div className="rounded-2xl bg-[#F8FAF7] border border-[#E2E8E0] p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#111C18]">
                      {uploadStepText}
                    </span>
                    <span className="font-mono-tabular font-bold text-emerald-700">
                      {uploadProgress}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-[#16A34A] transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadError && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-800 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => setIsUploadOpen(false)}
                  className="min-h-[48px] px-4 rounded-xl border border-[#E2E8E0] text-sm font-semibold text-[#111C18]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading || !selectedFile || !customName.trim()}
                  className="flex-1 min-h-[48px] rounded-xl bg-[#16A34A] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {isUploading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* In-App Document Viewer Modal */}
      {viewingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white border border-[#E2E8E0] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-[#E2E8E0] flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-[#111C18] truncate">
                  {viewingDoc.name}
                </h3>
                <p className="text-xs font-mono-tabular text-[#52635B]">
                  {formatBytesKB(viewingDoc.size)} · Stored in your Google Drive
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDownloadToPhone(viewingDoc)}
                  className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewingDoc(null);
                    if (viewerBlobUrl) {
                      URL.revokeObjectURL(viewerBlobUrl);
                      setViewerBlobUrl(null);
                    }
                  }}
                  className="min-h-[40px] min-w-[40px] rounded-xl border border-[#E2E8E0] flex items-center justify-center text-[#52635B]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-900 overflow-auto flex items-center justify-center p-4 min-h-[360px]">
              {loadingViewer ? (
                <div className="text-center text-white">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
                  <p className="text-xs">Decrypting preview from Google Drive...</p>
                </div>
              ) : viewerBlobUrl ? (
                viewingDoc.mimeType.includes('pdf') ||
                viewingDoc.name.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    src={viewerBlobUrl}
                    title={viewingDoc.name}
                    className="w-full h-[65vh] rounded-xl bg-white"
                  />
                ) : (
                  <img
                    src={viewerBlobUrl}
                    alt={viewingDoc.name}
                    referrerPolicy="no-referrer"
                    className="max-w-full max-h-[65vh] object-contain rounded-xl"
                  />
                )
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Rename Confirmation Modal (Mandatory Confirmation for Workspace Mutation) */}
      {docToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white border border-[#E2E8E0] p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#111C18]">
              Rename Document in Google Drive?
            </h3>
            <p className="mt-1 text-xs text-[#52635B]">
              This will update the filename of{' '}
              <strong className="text-[#111C18]">&ldquo;{docToRename.name}&rdquo;</strong> in your Google Drive.
            </p>
            <form onSubmit={handleConfirmRename} className="mt-4 space-y-4">
              <input
                type="text"
                required
                maxLength={80}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#E2E8E0] bg-[#F8FAF7] px-3.5 text-sm text-[#111C18]"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDocToRename(null)}
                  className="flex-1 min-h-[44px] rounded-xl border border-[#E2E8E0] text-sm font-semibold text-[#111C18]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenaming}
                  className="flex-1 min-h-[44px] rounded-xl bg-slate-900 text-white text-sm font-semibold"
                >
                  {isRenaming ? 'Renaming...' : 'Confirm Rename'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Mandatory per workspace-integration skill) */}
      {docToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white border border-[#E2E8E0] p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#111C18]">
              Delete Document from Google Drive?
            </h3>
            <p className="mt-2 text-sm text-[#52635B]">
              Are you sure you want to permanently delete{' '}
              <strong className="text-[#111C18]">&ldquo;{docToDelete.name}&rdquo;</strong> (
              {formatBytesKB(docToDelete.size)}) from your Google Drive? This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDocToDelete(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-[#E2E8E0] text-sm font-semibold text-[#111C18]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
