/** Tiny valid one-page PDF for browser import tests; no user content/assets. */
export function makeImportFixturePdf(text: string, filename = 'fixture.pdf'): File {
    const safe = text.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&');
    const stream = 'BT /F1 20 Tf 45 745 Td (' + safe + ') Tj ET\n';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream',
    ];
    let body='%PDF-1.4\n';
    const offsets=[0];
    for (let i=0;i<objects.length;i++) {
        offsets.push(body.length);
        body+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';
    }
    const xref=body.length;
    body+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
    for(const n of offsets.slice(1))body+=String(n).padStart(10,'0')+' 00000 n \n';
    body+='trailer\n<< /Root 1 0 R /Size '+(objects.length+1)+' >>\n';
    body+='startxref\n'+xref+'\n%%EOF\n';
    return new File([new TextEncoder().encode(body)],filename,{type:'application/pdf'});
}
