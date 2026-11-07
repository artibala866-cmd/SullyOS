import JSZip from 'jszip';

/** A small, valid DOCX ZIP with actual WordprocessingML paragraphs. */
export async function makeImportFixtureWord(text:string,filename='fixture.docx'):Promise<File>{
    const zip=new JSZip();
    const xmlEscape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const paragraphs=text.split(/\r?\n/).map(line=>
        '<w:p><w:r><w:t xml:space="preserve">'+xmlEscape(line)+'</w:t></w:r></w:p>').join('');
    zip.file('word/document.xml',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+
        paragraphs+'</w:body></w:document>');
    return new File([Uint8Array.from(await zip.generateAsync({type:'uint8array'})).buffer],
        filename,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
