'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { MAX_TEXT } = require('./reading-model');
async function readReadingFile(filename) {
  if(path.extname(filename).toLowerCase()==='.pdf')throw Error('PDF import is not supported in this preview. Export UTF-8 text first.');
  if (path.extname(filename).toLowerCase()==='.pdf'){
    const stat=await fs.stat(filename);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('Choose a PDF smaller than 20 MiB.');
    const bytes=await fs.readFile(filename);if(bytes.length>20*1024*1024)throw Error('PDF grew beyond the import limit.');
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdfRoot=path.dirname(require.resolve('pdfjs-dist/package.json'));
    const task=getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,standardFontDataUrl:path.join(pdfRoot,'standard_fonts').replace(/\\/g,'/')+'/',cMapUrl:path.join(pdfRoot,'cmaps').replace(/\\/g,'/')+'/',cMapPacked:true});
    try{const pdf=await task.promise;if(pdf.numPages>200)throw Error('Choose a PDF with at most 200 pages.');const pages=[];let length=0;for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();const text=content.items.map(item=>(item.str||'')+(item.hasEOL?'\n':' ')).join('').trim();length+=text.length+2;if(length>MAX_TEXT)throw Error('Use a PDF with up to 60,000 extracted characters.');pages.push(text);page.cleanup();}if(!pages.some(p=>p.trim()))throw Error('This PDF has no selectable text. Use a text-based PDF or paste an OCR transcript.');return {title:path.basename(filename,'.pdf'),text:pages.join('\n\n'),pages};}finally{await task.destroy();}
  }
  if (!['.txt', '.md'].includes(path.extname(filename).toLowerCase())) throw new Error('Choose a .txt, .md or text-based PDF file.');
  const handle = await fs.open(filename, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Choose a text file smaller than 256 KB.');
    // Bounded read also covers a file that grows after stat().
    const buffer = Buffer.alloc(256 * 1024 + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const part = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!part.bytesRead) break;
      bytesRead += part.bytesRead;
    }
    if (bytesRead > 256 * 1024) throw new Error('Choose a text file smaller than 256 KB.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
    if (text.length > MAX_TEXT) throw new Error('Use a text of up to 60,000 characters.');
    return { title: path.basename(filename, path.extname(filename)), text };
  } finally { await handle.close(); }
}
module.exports = { readReadingFile };
