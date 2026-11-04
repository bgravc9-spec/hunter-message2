import {useEffect,useState} from 'react';
import {getStorage,ref,getBlob,uploadBytes} from 'firebase/storage';
import {getApp} from 'firebase/app';

export const storageEnabled = import.meta.env.VITE_ENABLE_STORAGE === 'true';
export type MediaInfo = {mediaPath:string;mediaName:string;mediaType:string;mediaSize:number};

// Storage requires Firebase Blaze and deployed storage.rules; do not expose public download-token URLs.
export async function uploadPrivateMedia(chatId:string,uid:string,file:File):Promise<MediaInfo>{
 if(!storageEnabled)throw Error('Büyük medya için Blaze/Storage kurulumu gerekli. VITE_ENABLE_STORAGE=true ayarlayın.');
 const types=['image/jpeg','image/png','image/webp','video/mp4','video/webm','application/pdf','text/plain'];
 if(!types.includes(file.type))throw Error('Desteklenmeyen dosya biçimi (JPG, PNG, WebP, MP4, WebM, PDF, TXT).');
 if(file.size>20_000_000)throw Error('Dosya 20 MB altında olmalı.');
 const safe=file.name.replace(/[^a-zA-Z0-9_.-]/g,'_').slice(-90)||'dosya';
 const mediaPath=`chats/${chatId}/${uid}/${crypto.randomUUID()}_${safe}`;
 await uploadBytes(ref(getStorage(getApp()),mediaPath),file,{contentType:file.type});
 return {mediaPath,mediaName:file.name.slice(0,100),mediaType:file.type,mediaSize:file.size};
}

export function SecureMedia({path,name,type}:{path:string;name:string;type:string}){
 const [url,setUrl]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let stop=false;let created='';setUrl('');setError('');
  getBlob(ref(getStorage(getApp()),path)).then(blob=>{if(stop)return;created=URL.createObjectURL(blob);setUrl(created)}).catch(e=>!stop&&setError('Dosya açılamadı: '+(e?.code||'erişim hatası')));
  return()=>{stop=true;if(created)URL.revokeObjectURL(created)};
 },[path]);
 if(error)return <div className="v44-file-error">{error}</div>;
 if(!url)return <div className="v44-file-loading">Dosya yükleniyor…</div>;
 if(type.startsWith('image/'))return <a href={url} target="_blank" rel="noreferrer"><img className="chat-image" alt={name} src={url}/><small>🔎 Büyüt · {name}</small></a>;
 if(type.startsWith('video/'))return <video className="v44-video" controls playsInline src={url}/>;
 return <a className="v44-file-link" href={url} download={name}>📎 {name} · İndir</a>;
}
