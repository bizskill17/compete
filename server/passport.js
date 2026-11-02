import { randomUUID } from 'node:crypto';
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
function dimensions(bytes,type){
 if(type==='image/png'&&bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR')return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 if(type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){let p=2;while(p+4<bytes.length){if(bytes[p++]!==255)break;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;const size=bytes.readUInt16BE(p);if(size<2||p+size>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8)return [bytes.readUInt16BE(p+5),bytes.readUInt16BE(p+3)];p+=size;}}
 if(type==='image/webp'&&bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  const format=bytes.toString('ascii',12,16);
  if(format==='VP8X')return [1+bytes.readUIntLE(24,3),1+bytes.readUIntLE(27,3)];
  if(format==='VP8 '&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)return [bytes.readUInt16LE(26)&16383,bytes.readUInt16LE(28)&16383];
  if(format==='VP8L'&&bytes[20]===47){const n=bytes.readUInt32LE(21);return [(n&16383)+1,((n>>>14)&16383)+1];}
 }
 return null;
}
export function validatePassport(bytes,type){
 bytes=Buffer.from(bytes);
 if(!bytes.length||bytes.length>MAX_PHOTO_BYTES||!['image/jpeg','image/png','image/webp'].includes(type))throw Error('Choose a JPG, PNG or WebP passport photo up to 2 MB.');
 const size=dimensions(bytes,type);
 if(!size||size[0]<150||size[1]<200||size[0]>3000||size[1]>4000||size[0]*4!==size[1]*3)throw Error('Crop your passport photo to a 3:4 portrait, at least 150 × 200 pixels.');
 return bytes;
}
export function decodePassport(upload){
 if(!upload||typeof upload.data!=='string'||upload.data.length>2796204||(upload.data.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(upload.data)))throw Error('Invalid passport photo. Choose a JPG, PNG or WebP up to 2 MB.');
 return {bytes:validatePassport(Buffer.from(upload.data,'base64'),upload.type),type:upload.type};
}
export async function savePassport(store,account,bytes,type){
 const photoKey='passport/'+account.id+'/'+randomUUID();
 await store.put(photoKey,bytes,{httpMetadata:{contentType:type}});
 return {...account,photoKey,photoUpdatedAt:randomUUID()};
}
