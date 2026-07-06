import { FileCode, FileImage, FileJson, FileText } from 'lucide-react';

function MarkdownFileIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13v4M8 13l2 2 2-2v4M14 15l1.5 1.5 1.5-1.5M15.5 13v4" />
    </svg>
  );
}

export function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown': return <MarkdownFileIcon className="w-4 h-4 text-[#0969da] flex-shrink-0" />;
    case 'json':     return <FileJson  className="w-4 h-4 text-[#bf8700] flex-shrink-0" />;
    case 'css':
    case 'scss':
    case 'less':     return <FileCode  className="w-4 h-4 text-[#0969da] flex-shrink-0" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':      return <FileCode  className="w-4 h-4 text-[#d4a72c] flex-shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':     return <FileImage className="w-4 h-4 text-[#1a7f37] flex-shrink-0" />;
    case 'txt':      return <FileText  className="w-4 h-4 text-gray-500  flex-shrink-0" />;
    default:         return <FileText  className="w-4 h-4 text-gray-400  flex-shrink-0" />;
  }
}
