import {useEffect,useRef,useState} from 'react';
import {addDoc,collection,doc,onSnapshot,serverTimestamp,setDoc,updateDoc,type Firestore} from 'firebase/firestore';
import {Phone,PhoneOff,Video} from 'lucide-react';

type CallDoc={id:string;caller:string;callee:string;video:boolean;status:'ringing'|'connected'|'ended';offer?:RTCSessionDescriptionInit;answer?:RTCSessionDescriptionInit};
/** WebRTC pilot: active 1:1 chat only; STUN cannot guarantee connections across NAT. */
export default function CallPanel({db,chatId,uid,other}:{db:Firestore;chatId:string;uid:string;other:string}){
 const [incoming,setIncoming]=useState<CallDoc|null>(null),[current,setCurrent]=useState<CallDoc|null>(null),[status,setStatus]=useState(''),[mode,setMode]=useState<'audio'|'video'>('audio');
 const pcRef=useRef<RTCPeerConnection|null>(null),localStream=useRef<MediaStream|null>(null),remoteStream=useRef<MediaStream|null>(null);
 const localVideo=useRef<HTMLVideoElement>(null),remoteVideo=useRef<HTMLVideoElement>(null);
 const stops=useRef<Array<()=>void>>([]),seenCandidates=useRef(new Set<string>());
 function cleanup(){stops.current.forEach(fn=>fn());stops.current=[];pcRef.current?.close();pcRef.current=null;localStream.current?.getTracks().forEach(t=>t.stop());localStream.current=null;remoteStream.current=null;seenCandidates.current.clear();setCurrent(null);setStatus('')}
 useEffect(()=>{const unsub=onSnapshot(collection(db,'chats',chatId,'calls'),snap=>{
  const recent=snap.docs.map(d=>({id:d.id,...d.data()} as CallDoc)).filter(c=>c.status==='ringing'&&c.callee===uid);
  setIncoming(recent[recent.length-1]||null);
 });return()=>{unsub();cleanup()};},[chatId,uid,db]);
 useEffect(()=>{if(localVideo.current)localVideo.current.srcObject=localStream.current;if(remoteVideo.current)remoteVideo.current.srcObject=remoteStream.current},[current,mode]);
 async function connect(call:CallDoc,isCaller:boolean){
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Bu cihazda mikrofon/kamera bağlantısı desteklenmiyor.');
  const media=await navigator.mediaDevices.getUserMedia({audio:true,video:call.video});localStream.current=media;
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pcRef.current=pc;setMode(call.video?'video':'audio');
  pc.onconnectionstatechange=()=>setStatus(pc.connectionState==='connected'?'Bağlandı':pc.connectionState==='failed'?'Bağlantı kurulamadı (TURN sunucusu gerekebilir)':pc.connectionState);
  media.getTracks().forEach(t=>pc.addTrack(t,media));remoteStream.current=new MediaStream();pc.ontrack=e=>{e.streams[0]?.getTracks().forEach(t=>{if(!remoteStream.current?.getTracks().some(x=>x.id===t.id))remoteStream.current?.addTrack(t)});if(remoteVideo.current)remoteVideo.current.srcObject=remoteStream.current};
  const path=doc(db,'chats',chatId,'calls',call.id);
  pc.onicecandidate=e=>{if(e.candidate)void addDoc(collection(path,isCaller?'callerCandidates':'calleeCandidates'),{candidate:e.candidate.toJSON(),from:uid,createdAt:serverTimestamp()}).catch(console.error)};
  const candColl=collection(path,isCaller?'calleeCandidates':'callerCandidates');
  stops.current.push(onSnapshot(candColl,snap=>snap.docChanges().forEach(change=>{
   if(change.type!=='added'||seenCandidates.current.has(change.doc.id))return;seenCandidates.current.add(change.doc.id);
   const candidate=change.doc.data().candidate as RTCIceCandidateInit;
   const add=()=>{void pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error)};
   if(pc.remoteDescription)add();else setTimeout(()=>{if(pc.remoteDescription)add()},750);
  })));
  stops.current.push(onSnapshot(path,snap=>{if(!snap.exists()||snap.data().status==='ended'){cleanup();return}
   const d=snap.data() as CallDoc;
   if(isCaller&&d.answer&&!pc.remoteDescription)void pc.setRemoteDescription(d.answer).catch(e=>setStatus(String(e)));
  }));
  if(isCaller){const offer=await pc.createOffer();await pc.setLocalDescription(offer);await updateDoc(path,{offer:{type:offer.type,sdp:offer.sdp}})}
  else {if(!call.offer)throw Error('Arama teklifi bulunamadı.');await pc.setRemoteDescription(call.offer);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await updateDoc(path,{answer:{type:answer.type,sdp:answer.sdp},status:'connected'});setIncoming(null)}
  setCurrent(call);
 }
 async function start(video:boolean){if(current)return;try{
  const callRef=doc(collection(db,'chats',chatId,'calls'));
  const call:CallDoc={id:callRef.id,caller:uid,callee:other,video,status:'ringing'};
  await setDoc(callRef,{caller:uid,callee:other,video,status:'ringing',createdAt:serverTimestamp()});await connect(call,true);
 }catch(e){cleanup();setStatus('Arama başlatılamadı: '+String(e))}}
 async function accept(){if(!incoming)return;try{await connect(incoming,false)}catch(e){cleanup();setStatus('Arama kabul edilemedi: '+String(e))}}
 async function hangUp(){const id=current?.id||incoming?.id;try{if(id)await updateDoc(doc(db,'chats',chatId,'calls',id),{status:'ended'})}catch{}cleanup();setIncoming(null)}
 return <>
  <div className="v44-call-buttons"><button type="button" title="Sesli arama (beta)" onClick={()=>void start(false)}><Phone size={18}/></button><button type="button" title="Görüntülü arama (beta)" onClick={()=>void start(true)}><Video size={18}/></button></div>
  {(incoming||current||status)&&<div className="v44-call-overlay"><div className="v44-call-card"><strong>{current?'HUNTER araması':incoming?'Gelen arama':'Arama durumu'}</strong><small>{status||((incoming?.video||current?.video)?'Görüntülü':'Sesli')+' arama · Beta'}</small>
    {current&&<><video ref={remoteVideo} autoPlay playsInline className="v44-call-video"/><video ref={localVideo} autoPlay playsInline muted className="v44-self-video"/></>}
    {incoming&&!current&&<button className="primary" onClick={()=>void accept()}>Aramayı kabul et</button>}
    <button className="v44-hangup" onClick={()=>void hangUp()}><PhoneOff size={18}/> {current||incoming?'Kapat / Reddet':'Kapat'}</button>
    <small>Güvenilir arama için TURN ve arama bildirimleri kurmak gerekir. Bu sürüm uçtan uca şifreleme garantisi sunmaz.</small>
   </div></div>}
 </>;
}
