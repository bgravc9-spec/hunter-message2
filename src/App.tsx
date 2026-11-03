import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { auth, db, configured } from './firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile, PhoneAuthProvider, RecaptchaVerifier, signInWithCredential, linkWithCredential, type User } from 'firebase/auth';
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch, type Timestamp } from 'firebase/firestore';
import VoiceRecorder, { type VoicePayload } from './VoiceRecorder';
import { MessageCircle, Search, Send, LogOut, UserRound, Settings, Plus, ArrowLeft, ShieldCheck, Users, Sun, Moon, LockKeyhole, CheckCheck, Check, Smile, Phone, Video, MoreVertical, ShieldAlert, X, Reply, Pencil, Trash2, Pin, PinOff, BellOff, Bell, ImagePlus, Flag, Ban, CheckCircle2 } from 'lucide-react';

type Person = { uid:string; name:string; username:string; email?:string; bio?:string; photoData?:string; lastSeenAt?:Timestamp; showPresence?:boolean };
type Chat = {id:string; members:string[]; membersInfo:Record<string,string>; groupDescription?:string; groupPhoto?:string; lastMessage?:string; lastSenderId?:string; lastMessageAt?:Timestamp; updatedAt?:Timestamp; readAt?:Record<string,Timestamp>; kind?:'group'; groupName?:string; groupIcon?:string; adminId?:string};
type ReplyMeta = {id:string; text:string; senderName:string};
type Msg = {id:string; senderId:string; text:string; createdAt?:Timestamp; editedAt?:Timestamp; deletedAt?:Timestamp; reactions?:Record<string,string>; replyTo?:ReplyMeta; kind?:'image'|'text'|'voice'; imageData?:string; voiceData?:string; voiceDuration?:number};
type Pref = {pinned:boolean;muted:boolean};
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
const norm=(s:string)=>s.trim().toLowerCase().replace(/^@/,'');
const emojiGroups:Record<string,string[]>={
 'Sık kullanılan':['😀','😂','❤️','👍','😎','🔥','🥰','😍','😊','🙏','🎉','👌','👋','😅','🤝'],
 'Yüzler':['😀','😄','😁','🤣','😂','🙂','🙃','😉','😍','🥰','😘','😜','🤔','🥺','😭','😡','😴','😎','🤩'],
 'Eller':['👍','👎','👏','🙌','🫶','✌️','👌','🤝','🙏','👋','💪'],
 'Kalpler':['❤️','🩷','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕'],
 'Diğer':['🔥','✨','⭐','⚡','🎉','🎁','🌹','🐺','🐱','🍕','☕','⚽','🚀','✅']
};
const quickEmojis=['😀','😂','❤️','👍','😎','🔥'];
const accents:Record<string,{main:string,light:string}>={blue:{main:'#2196f3',light:'#67b9ff'},green:{main:'#0caa78',light:'#70dfb2'},purple:{main:'#8c59df',light:'#c5a3fa'},orange:{main:'#ec8034',light:'#ffc08b'}};
const local=(key:string,initial:string)=>{try{return localStorage.getItem(key)||initial}catch{return initial}};
const time=(t?:Timestamp)=>t?new Date(t.seconds*1000).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}):'…';

/** Small JPEG only; avoid Firestore document's 1MiB cap. NOT suitable for video/full-size media. */
async function compressImage(file:File):Promise<string>{
 if(!file.type.startsWith('image/'))throw Error('Lütfen bir resim seç.');
 if(file.size>12*1024*1024)throw Error('Kaynak resim 12 MB altında olmalı.');
 const url=URL.createObjectURL(file);
 try{
  const img=new Image();img.src=url;await img.decode();
  const max=640,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Resim işlenemedi.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  for(let quality=.72;quality>=.25;quality-=.1){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<90000)return data;}
  throw Error('Fotoğraf bu sürüm için çok büyük. Daha küçük bir resim seç.');
 }finally{URL.revokeObjectURL(url)}
}

function UnreadBadge({chat,uid}:{chat:Chat;uid:string}){
 const [count,setCount]=useState(0);
 const lastRead=chat.readAt?.[uid]?.seconds||0;
 useEffect(()=>{if(!db){setCount(0);return}
  const store=db;
  // On-demand read of latest 100; counts may show 99+ in very busy conversations.
  getDocs(query(collection(store,'chats',chat.id,'messages'),orderBy('createdAt','desc'),limit(100)))
   .then(s=>setCount(s.docs.filter(d=>d.data().senderId!==uid&&(d.data().createdAt?.seconds||0)>lastRead).length))
   .catch(()=>setCount(0));
 },[chat.id,chat.lastMessageAt?.seconds,chat.lastSenderId,uid,lastRead]);
 return count>0?<span className="unread-badge">{count>=100?'99+':count}</span>:null;
}

export default function App(){
 const [user,setUser]=useState<User|null>(null),[boot,setBoot]=useState(true),[tab,setTab]=useState<'chats'|'people'|'settings'>('chats');
 const [dark,setDark]=useState(local('hunter-theme','dark')==='dark');
 const [accent,setAccent]=useState(local('hunter-accent','blue'));
 const [profile,setProfile]=useState<Person|null>(null),[chats,setChats]=useState<Chat[]>([]),[active,setActive]=useState<string|null>(null),[messages,setMessages]=useState<Msg[]>([]);
 const [draft,setDraft]=useState(''),[lookup,setLookup]=useState(''),[found,setFound]=useState<Person|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [mode,setMode]=useState<'login'|'register'|'phone'>('login'),[email,setEmail]=useState(''),[pass,setPass]=useState(''),[name,setName]=useState(''),[handle,setHandle]=useState(''),[number,setNumber]=useState(''),[otp,setOtp]=useState(''),[confirmationId,setConfirmationId]=useState('');
 const [emojiOpen,setEmojiOpen]=useState(false),[emojiQuery,setEmojiQuery]=useState(''),[chatMenu,setChatMenu]=useState(false),[localInfo,setLocalInfo]=useState('');
 const [targetMsg,setTargetMsg]=useState<Msg|null>(null),[reply,setReply]=useState<ReplyMeta|null>(null),[editing,setEditing]=useState<string|null>(null);
 const [searchOpen,setSearchOpen]=useState(false),[searchText,setSearchText]=useState('');
 const [prefs,setPrefs]=useState<Record<string,Pref>>({}),[partnerProfile,setPartnerProfile]=useState<Person|null>(null),[typing,setTyping]=useState(false);
 const [groupMode,setGroupMode]=useState(false),[groupName,setGroupName]=useState(''),[groupDescription,setGroupDescription]=useState(''),[groupIcon,setGroupIcon]=useState('👥'),[groupPhoto,setGroupPhoto]=useState(''),[groupUsers,setGroupUsers]=useState<Person[]>([]);
 const [showPresence,setShowPresence]=useState(true);
 const [imageBusy,setImageBusy]=useState(false);
 const [profileView,setProfileView]=useState<'self'|'partner'|'group'|null>(null);
 const [profileEditName,setProfileEditName]=useState(''),[profileEditBio,setProfileEditBio]=useState(''),[profileEditPhoto,setProfileEditPhoto]=useState('');
 const [profileSaving,setProfileSaving]=useState(false),[profilePhotoBusy,setProfilePhotoBusy]=useState(false),[profileError,setProfileError]=useState('');
 const [photoViewer,setPhotoViewer]=useState<{src:string;label:string}|null>(null),[photoZoom,setPhotoZoom]=useState(1);
 const [contactProfiles,setContactProfiles]=useState<Record<string,Person>>({});
 const [groupEditName,setGroupEditName]=useState(''),[groupEditDescription,setGroupEditDescription]=useState(''),[groupEditPhoto,setGroupEditPhoto]=useState(''),[groupEditIcon,setGroupEditIcon]=useState('👥');
 const [groupFindHandle,setGroupFindHandle]=useState(''),[groupFoundPerson,setGroupFoundPerson]=useState<Person|null>(null),[groupError,setGroupError]=useState(''),[groupManageBusy,setGroupManageBusy]=useState(false);
 const groupPhotoInput=useRef<HTMLInputElement|null>(null);
 const recaptcha=useRef<RecaptchaVerifier|null>(null),bottom=useRef<HTMLDivElement|null>(null),composeInput=useRef<HTMLTextAreaElement|null>(null),fileInput=useRef<HTMLInputElement|null>(null),profilePhotoInput=useRef<HTMLInputElement|null>(null),pressTimer=useRef<ReturnType<typeof setTimeout>|null>(null),lastTypingWrite=useRef(0),typingTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const noticeTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const info=(msg:string)=>{setLocalInfo(msg);if(noticeTimer.current)clearTimeout(noticeTimer.current);noticeTimer.current=setTimeout(()=>setLocalInfo(''),4800)};
 const addEmoji=(value:string)=>{setDraft(d=>d+value);composeInput.current?.focus()};
 const selected=chats.find(c=>c.id===active);
 const isGroup=selected?.kind==='group';
 const partner=selected&&!isGroup?selected.members.find(m=>m!==user?.uid):undefined;
 const partnerName=isGroup?(selected?.groupName||'Grup'):(partner?selected?.membersInfo?.[partner]||'Kullanıcı':'Sohbet');
 const selectedPref=active?prefs[active]:undefined;
 const [blockedOther,setBlockedOther]=useState(false);
 const avatar=(person:Person|null|undefined,fallback:string)=>person?.photoData?<img className="user-avatar-image" src={person.photoData} alt="Profil fotoğrafı"/>:fallback.slice(0,1).toLocaleUpperCase('tr-TR');
 const showPhoto=(src:string,label:string)=>{setPhotoViewer({src,label});setPhotoZoom(1)};
 const openConversationProfile=()=>{
  if(isGroup && selected){
   setGroupEditName(selected.groupName||'Grup');setGroupEditDescription(selected.groupDescription||'');
   setGroupEditIcon(selected.groupIcon||'👥');setGroupEditPhoto(selected.groupPhoto||'');
   setGroupFindHandle('');setGroupFoundPerson(null);setGroupError('');setProfileView('group');
  }else if(selected){setProfileView('partner')}
 };
 const openSelfProfile=()=>{if(!profile)return;setProfileError('');setProfileEditName(profile.name);setProfileEditBio(profile.bio||'');setProfileEditPhoto(profile.photoData||'');setProfileView('self')};
 const closeProfile=()=>{if(profileSaving||profilePhotoBusy)return;setProfileView(null)};
 async function saveProfile(){
  if(!db||!user||!profile)return;
  const nextName=profileEditName.trim(),bio=profileEditBio.trim();
  if(nextName.length<1||nextName.length>80)throw Error('İsim 1–80 karakter olmalı.');
  if(bio.length>160)throw Error('Hakkımda en fazla 160 karakter olabilir.');
  setProfileSaving(true);
  try{
   await updateDoc(doc(db,'users',user.uid),{
    name:nextName,bio,
    photoData:profileEditPhoto||deleteField(),
    ...(profile.email?{email:deleteField()}:{})
   });
   if(auth?.currentUser&&auth.currentUser.displayName!==nextName)await updateProfile(auth.currentUser,{displayName:nextName}).catch(()=>{});
   setProfileView(null);
   info('Profil güncellendi.');
  }finally{setProfileSaving(false)}
 }
 async function chooseProfilePhoto(file?:File){
  if(!file)return;setProfilePhotoBusy(true);
  try{setProfileEditPhoto(await compressImage(file));setProfileError('')}catch(e){setProfileError(err(e))}
  finally{setProfilePhotoBusy(false);if(profilePhotoInput.current)profilePhotoInput.current.value=''}
 }


 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('hunter-theme',dark?'dark':'light')},[dark]);
 useEffect(()=>{localStorage.setItem('hunter-accent',accent);document.documentElement.style.setProperty('--blue',accents[accent]?.light||accents.blue.light);document.documentElement.style.setProperty('--hunter-accent',accents[accent]?.main||accents.blue.main)},[accent]);
 useEffect(()=>{document.documentElement.dataset.native=Capacitor.getPlatform()==='android'?'android':'web';const vv=window.visualViewport;const update=()=>document.documentElement.style.setProperty('--viewport-height',(vv?.height||window.innerHeight)+'px');update();vv?.addEventListener('resize',update);window.addEventListener('resize',update);return()=>{vv?.removeEventListener('resize',update);window.removeEventListener('resize',update)}},[]);
 useEffect(()=>{if(!auth){setBoot(false);return}return onAuthStateChanged(auth,u=>{setUser(u);setBoot(false)})},[]);
 useEffect(()=>{if(!user||!db){setChats([]);setProfile(null);return}const store=db;
  const unsubProfile=onSnapshot(doc(store,'users',user.uid),s=>{if(s.exists()){const p=s.data() as Person;setProfile(p);setShowPresence(p.showPresence!==false);if(p.email)void updateDoc(doc(store,'users',user.uid),{email:deleteField()}).catch(()=>{})}else setProfile(null)},e=>setNotice(err(e)));
  const unsubChats=onSnapshot(query(collection(store,'chats'),where('members','array-contains',user.uid)),s=>setChats(s.docs.map(d=>({id:d.id,...d.data()} as Chat))),e=>setNotice(err(e)));
  const unsubPrefs=onSnapshot(collection(store,'users',user.uid,'chatPrefs'),s=>{const result:Record<string,Pref>={};s.docs.forEach(d=>result[d.id]={pinned:!!d.data().pinned,muted:!!d.data().muted});setPrefs(result)},e=>setNotice(err(e)));
  return()=>{unsubProfile();unsubChats();unsubPrefs()};
 },[user]);
 // Approximate presence only: Firestore has no server onDisconnect. Hidden when user opts out.
 useEffect(()=>{if(!db||!user||!profile||!showPresence)return;const store=db;
  const pulse=()=>{if(!document.hidden)updateDoc(doc(store,'users',user.uid),{lastSeenAt:serverTimestamp()}).catch(()=>{})};
  pulse();const timer=setInterval(pulse,40000);document.addEventListener('visibilitychange',pulse);
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',pulse)};
 },[user?.uid,!!profile,showPresence]);
 useEffect(()=>{if(!partner||!db){setPartnerProfile(null);return}const store=db;return onSnapshot(doc(store,'users',partner),s=>setPartnerProfile(s.exists()?s.data() as Person:null),()=>setPartnerProfile(null))},[partner]);
 // User directory cache for avatars in chat list; listen only to first 40 unique contacts.
 useEffect(()=>{if(!db||!user)return;const store=db;
  const ids=[...new Set(chats.filter(c=>c.kind!=='group').flatMap(c=>c.members.filter(id=>id!==user.uid)))].slice(0,40);
  if(!ids.length){setContactProfiles({});return}
  const stops=ids.map(id=>onSnapshot(doc(store,'users',id),snap=>setContactProfiles(p=>snap.exists()?{...p,[id]:snap.data() as Person}:p),()=>{}));
  return()=>stops.forEach(unsub=>unsub());
 },[user?.uid,chats.map(c=>c.id).join('|')]);
 useEffect(()=>{if(!partner||!db||!user){setBlockedOther(false);return}const store=db;return onSnapshot(doc(store,'users',user.uid,'blocks',partner),s=>setBlockedOther(s.exists()),()=>setBlockedOther(false))},[partner,user]);
 useEffect(()=>{if(!active||!db)return;const store=db;setMessages([]);return onSnapshot(query(collection(store,'chats',active,'messages'),orderBy('createdAt','desc'),limit(250)),s=>{setMessages(s.docs.map(d=>({id:d.id,...d.data()} as Msg)).reverse());setTimeout(()=>bottom.current?.scrollIntoView({behavior:'smooth',block:'end'}),50)},e=>setNotice(err(e)))},[active]);
 const markRead=useCallback(async(chatId:string)=>{if(!db||!user||document.hidden)return;try{await updateDoc(doc(db,'chats',chatId),{[`readAt.${user.uid}`]:serverTimestamp()})}catch(e){/* leave UI usable on older rule sets */console.debug('read state:',e)}},[user]);
 useEffect(()=>{if(!active||!messages.length)return;const unseen=messages.some(m=>m.senderId!==user?.uid&&m.createdAt?.seconds&&(m.createdAt.seconds>(selected?.readAt?.[user?.uid||'']?.seconds||0)));if(unseen)void markRead(active)},[active,messages,markRead,selected?.readAt,user?.uid]);
 useEffect(()=>{if(!active||!db)return;const store=db;return onSnapshot(collection(store,'chats',active,'typing'),s=>{const now=Date.now()/1000;setTyping(s.docs.some(d=>d.id!==user?.uid&&d.data().isTyping===true&&now-(d.data().updatedAt?.seconds||0)<8))},()=>setTyping(false))},[active,user?.uid]);
 useEffect(()=>{if(!composeInput.current)return;composeInput.current.style.height='auto';composeInput.current.style.height=Math.min(composeInput.current.scrollHeight,120)+'px'},[draft,active]);
 useEffect(()=>{setProfileView(null);setEmojiOpen(false);setChatMenu(false);setDraft('');setReply(null);setEditing(null);setTargetMsg(null);setSearchOpen(false);setTyping(false)},[active]);
 useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){setPhotoViewer(null);setProfileView(null);setTargetMsg(null)}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[]);
 useEffect(()=>()=>{if(typingTimer.current)clearTimeout(typingTimer.current);if(pressTimer.current)clearTimeout(pressTimer.current);if(noticeTimer.current)clearTimeout(noticeTimer.current)},[]);

 async function safe(fn:()=>Promise<void>){setBusy(true);setNotice('');try{await fn()}catch(e){setNotice(err(e))}finally{setBusy(false)}}
 async function createProfile(uid:string,h:string,display:string,e?:string){if(!db)return;const store=db;await runTransaction(store,async t=>{const hdoc=doc(store,'usernames',h),pdoc=doc(store,'users',uid);if((await t.get(hdoc)).exists())throw Error('Bu kullanıcı adı alınmış.');t.set(hdoc,{uid});t.set(pdoc,{uid,username:h,name:display,createdAt:serverTimestamp()})});setProfile({uid,username:h,name:display,email:e})}
 async function register(){if(!auth||!db)return;const h=norm(handle);if(!/^[a-z0-9_]{3,20}$/.test(h))throw Error('Kullanıcı adı 3-20 karakter, yalnızca a-z, 0-9 ve _ içermelidir.');if(!name.trim())throw Error('Ad gerekli.');const credential=await createUserWithEmailAndPassword(auth,email,pass);await updateProfile(credential.user,{displayName:name.trim()});await createProfile(credential.user.uid,h,name.trim(),email)}
 async function login(){if(auth)await signInWithEmailAndPassword(auth,email,pass)}
 async function sendCode(){if(!auth)return;if(!/^\+[1-9]\d{7,14}$/.test(number))throw Error('Telefonu +905xxxxxxxxx biçiminde gir.');if(!recaptcha.current)recaptcha.current=new RecaptchaVerifier(auth,'recaptcha-container',{size:'normal'});await recaptcha.current.render();const provider=new PhoneAuthProvider(auth);setConfirmationId(await provider.verifyPhoneNumber(number,recaptcha.current));setNotice('SMS kodu gönderildi.')}
 async function verifyCode(){if(!auth)return;const cred=PhoneAuthProvider.credential(confirmationId,otp);if(auth.currentUser&&auth.currentUser.isAnonymous)await linkWithCredential(auth.currentUser,cred);else await signInWithCredential(auth,cred)}
 async function createPhoneProfile(){if(!user)return;const h=norm(handle);if(!/^[a-z0-9_]{3,20}$/.test(h))throw Error('Kullanıcı adı geçersiz.');if(!name.trim())throw Error('Ad gerekli.');await createProfile(user.uid,h,name.trim(),user.email||'')}
 async function searchPerson(){if(!db||!user)return;setFound(null);const h=norm(lookup);if(!h)return;const nameRef=await getDoc(doc(db,'usernames',h));if(!nameRef.exists()){setNotice('Kullanıcı bulunamadı.');return}const id=nameRef.data().uid as string;if(id===user.uid){setNotice('Bu senin hesabın.');return}const p=await getDoc(doc(db,'users',id));if(p.exists())setFound(p.data() as Person)}
 async function openChat(person:Person){if(!db||!user||!profile)return;const store=db,ids=[user.uid,person.uid].sort(),chatId=ids.join('_');await runTransaction(store,async t=>{const ref=doc(store,'chats',chatId);if(!(await t.get(ref)).exists())t.set(ref,{members:ids,membersInfo:{[user.uid]:profile.name,[person.uid]:person.name},createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessage:''})});setActive(chatId);setFound(null);setTab('chats')}
 async function findGroupMember(){
  if(!db||!user||!selected||selected.kind!=='group'||selected.adminId!==user.uid)return;
  setGroupError('');setGroupFoundPerson(null);
  const h=norm(groupFindHandle);
  if(!/^[a-z0-9_]{3,20}$/.test(h))throw Error('Geçerli bir @kullaniciadi gir.');
  const nameSnap=await getDoc(doc(db,'usernames',h));
  if(!nameSnap.exists())throw Error('Kullanıcı bulunamadı.');
  const id=nameSnap.data().uid as string;
  if(selected.members.includes(id))throw Error('Bu kişi zaten grupta.');
  const personSnap=await getDoc(doc(db,'users',id));
  if(!personSnap.exists())throw Error('Kullanıcı profili bulunamadı.');
  setGroupFoundPerson(personSnap.data() as Person);
 }
 async function addGroupMember(person:Person){
  if(!db||!user||!selected||selected.kind!=='group'||selected.adminId!==user.uid)return;
  const chatRef=doc(db,'chats',selected.id);
  await runTransaction(db,async tx=>{
   const snap=await tx.get(chatRef);if(!snap.exists())throw Error('Grup bulunamadı.');
   const chat=snap.data() as Chat;
   if(chat.adminId!==user.uid)throw Error('Yalnızca yönetici üye ekleyebilir.');
   if(chat.members.includes(person.uid))throw Error('Bu kişi zaten grupta.');
   if(chat.members.length>=30)throw Error('Grup en fazla 30 kişilik olabilir.');
   tx.update(chatRef,{members:[...chat.members,person.uid],membersInfo:{...chat.membersInfo,[person.uid]:person.name}});
  });
  setGroupFoundPerson(null);setGroupFindHandle('');info(person.name+' gruba eklendi.');
 }
 async function removeGroupMember(id:string){
  if(!db||!user||!selected||selected.kind!=='group'||selected.adminId!==user.uid)return;
  if(id===selected.adminId)throw Error('Grup kurucusu çıkarılamaz.');
  if(!window.confirm('Bu üyeyi gruptan çıkarmak istiyor musun?'))return;
  const chatRef=doc(db,'chats',selected.id);
  await runTransaction(db,async tx=>{
   const snap=await tx.get(chatRef);if(!snap.exists())throw Error('Grup bulunamadı.');
   const chat=snap.data() as Chat;
   if(chat.adminId!==user.uid)throw Error('Yalnızca yönetici üye çıkarabilir.');
   if(!chat.members.includes(id))throw Error('Üye grupta bulunamadı.');
   if(chat.members.length<=1)throw Error('Grup kurucusu tek başına kalabilir; kurucu çıkarılamaz.');
   const names={...chat.membersInfo};delete names[id];
   tx.update(chatRef,{members:chat.members.filter(u=>u!==id),membersInfo:names});
  });
  info('Üye gruptan çıkarıldı.');
 }
 async function saveGroupInfo(){
  if(!db||!user||!selected||selected.kind!=='group'||selected.adminId!==user.uid)return;
  const groupNameValue=groupEditName.trim();
  if(!groupNameValue||groupNameValue.length>80)throw Error('Grup adı 1-80 karakter olmalı.');
  if(groupEditDescription.length>500)throw Error('Grup açıklaması en fazla 500 karakter olabilir.');
  await updateDoc(doc(db,'chats',selected.id),{
   groupName:groupNameValue,groupDescription:groupEditDescription.trim(),
   groupIcon:groupEditIcon,groupPhoto:groupEditPhoto||deleteField()
  });
  info('Grup bilgileri güncellendi.');
 }
 async function changeGroupPhoto(file?:File){
  if(!file)return;
  setGroupManageBusy(true);
  try{setGroupEditPhoto(await compressImage(file));setGroupError('')}
  catch(e){setGroupError(err(e))}
  finally{setGroupManageBusy(false);if(groupPhotoInput.current)groupPhotoInput.current.value=''}
 }
 async function manageGroupAction(action:()=>Promise<void>){
  setGroupManageBusy(true);setGroupError('');
  try{await action()}catch(e){setGroupError(err(e))}
  finally{setGroupManageBusy(false)}
 }
 async function createGroup(){if(!db||!user||!profile)return;if(!groupName.trim())throw Error('Grup adı gir.');if(groupUsers.length<1)throw Error('Gruba en az bir kişi ekle.');const store=db;const members=[user.uid,...groupUsers.map(p=>p.uid)],names:Record<string,string>={[user.uid]:profile.name};groupUsers.forEach(p=>names[p.uid]=p.name);const ref=doc(collection(store,'chats'));const id='group_'+ref.id;await setDoc(doc(store,'chats',id),{kind:'group',groupName:groupName.trim().slice(0,80),groupDescription:groupDescription.trim().slice(0,500),groupIcon,...(groupPhoto?{groupPhoto}:{}),adminId:user.uid,members,membersInfo:names,lastMessage:'',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});setActive(id);setTab('chats');setGroupMode(false);setGroupName('');setGroupDescription('');setGroupPhoto('');setGroupUsers([]);setFound(null);setLookup('')}
 async function setChatPref(chatId:string,patch:Partial<Pref>){if(!db||!user)return;const cur=prefs[chatId]||{pinned:false,muted:false};await setDoc(doc(db,'users',user.uid,'chatPrefs',chatId),{...cur,...patch,updatedAt:serverTimestamp()});setChatMenu(false)}
 async function setTypingState(value:boolean){if(!db||!user||!active)return;await setDoc(doc(db,'chats',active,'typing',user.uid),{isTyping:value,updatedAt:serverTimestamp()}).catch(()=>{})}
 function typingInput(v:string){setDraft(v);if(!active||!user)return;if(Date.now()-lastTypingWrite.current>3000){lastTypingWrite.current=Date.now();void setTypingState(!!v.trim())}if(typingTimer.current)clearTimeout(typingTimer.current);typingTimer.current=setTimeout(()=>void setTypingState(false),3500)}
 async function send(){if(!db||!user||!active)return;const val=draft.trim();if(!val||blockedOther)return;const data:Record<string,unknown>={senderId:user.uid,text:val,createdAt:serverTimestamp()};if(reply)data.replyTo=reply;const store=db;const batch=writeBatch(store);batch.set(doc(collection(store,'chats',active,'messages')),data);batch.update(doc(store,'chats',active),{lastMessage:val.slice(0,200),lastSenderId:user.uid,lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});setDraft('');setReply(null);void setTypingState(false);try{await batch.commit()}catch(e){setDraft(val);setNotice(err(e))}}
 async function uploadImage(file?:File){if(!file||!db||!user||!active)return;if(blockedOther){info('Bu kullanıcı engelli.');return}setImageBusy(true);try{const imageData=await compressImage(file);const batch=writeBatch(db);const data:Record<string,unknown>={kind:'image',senderId:user.uid,text:'',imageData,createdAt:serverTimestamp()};if(reply)data.replyTo=reply;batch.set(doc(collection(db,'chats',active,'messages')),data);batch.update(doc(db,'chats',active),{lastMessage:'📷 Fotoğraf',lastSenderId:user.uid,lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});await batch.commit();setReply(null)}catch(e){setNotice(err(e))}finally{setImageBusy(false);if(fileInput.current)fileInput.current.value=''}}
 async function sendVoiceMessage(voice:VoicePayload){
  if(!db||!user||!active||blockedOther)throw Error('Sesli mesaj bu sohbete gönderilemiyor.');
  if(voice.dataUri.length>125000)throw Error('Ses kaydı çok büyük. Daha kısa bir kayıt dene.');
  const targetChat=active;
  const batch=writeBatch(db);
  const msg:Record<string,unknown>={kind:'voice',senderId:user.uid,text:'',voiceData:voice.dataUri,voiceDuration:voice.duration,createdAt:serverTimestamp()};
  if(reply)msg.replyTo=reply;
  batch.set(doc(collection(db,'chats',targetChat,'messages')),msg);
  batch.update(doc(db,'chats',targetChat),{lastMessage:'🎤 Sesli mesaj',lastSenderId:user.uid,lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});
  await batch.commit();
  setReply(null);
 }
 async function reactTo(msg:Msg,emoji:string){if(!db||!user||!active)return;const current=msg.reactions?.[user.uid]||'';await updateDoc(doc(db,'chats',active,'messages',msg.id),{[`reactions.${user.uid}`]:current===emoji?deleteField():emoji});setTargetMsg(null)}
 function chooseReply(msg:Msg){setReply({id:msg.id,text:(msg.kind==='image'?'📷 Fotoğraf':msg.kind==='voice'?'🎤 Sesli mesaj':msg.text).slice(0,120),senderName:msg.senderId===user?.uid?'Sen':(selected?.membersInfo[msg.senderId]||'Kullanıcı')});setTargetMsg(null);composeInput.current?.focus()}
 function startEdit(msg:Msg){if(msg.senderId!==user?.uid||msg.deletedAt||msg.kind==='image'||msg.kind==='voice')return;if(!msg.createdAt||Date.now()-msg.createdAt.seconds*1000>=15*60*1000){info('Bu mesajın 15 dakikalık düzenleme süresi doldu.');setTargetMsg(null);return}setEditing(msg.id);setDraft(msg.text);setReply(null);setTargetMsg(null);composeInput.current?.focus()}
 async function saveEdit(){if(!db||!active||!editing)return;const val=draft.trim();if(!val)return;await updateDoc(doc(db,'chats',active,'messages',editing),{text:val,editedAt:serverTimestamp()});setEditing(null);setDraft('')}
 async function deleteMessage(msg:Msg){if(!db||!active||msg.senderId!==user?.uid)return;if(!window.confirm('Bu mesaj herkes için silinsin mi?'))return;const data:Record<string,unknown>={text:'',deletedAt:serverTimestamp()};if(msg.imageData)data.imageData=deleteField();if(msg.voiceData){data.voiceData=deleteField();data.voiceDuration=deleteField()}await updateDoc(doc(db,'chats',active,'messages',msg.id),data);setTargetMsg(null)}
 async function toggleBlock(){if(!db||!user||!partner)return;if(blockedOther)await deleteDoc(doc(db,'users',user.uid,'blocks',partner));else await setDoc(doc(db,'users',user.uid,'blocks',partner),{createdAt:serverTimestamp()});setChatMenu(false);info(blockedOther?'Engel kaldırıldı.':'Kullanıcı engellendi.')}
 async function reportPerson(reason:'spam'|'abuse'|'other'){if(!db||!user||!partner||!active)return;await addDoc(collection(db,'reports'),{reporterId:user.uid,targetId:partner,chatId:active,reason,createdAt:serverTimestamp()});setChatMenu(false);info('Şikâyetin kaydedildi; inceleme ekibi henüz aktif değil.')}
 async function presenceToggle(){if(!db||!user)return;await updateDoc(doc(db,'users',user.uid),{showPresence:!showPresence,lastSeenAt:showPresence?deleteField():serverTimestamp()})}
 const presenceText=useMemo(()=>{if(isGroup)return `${selected?.members.length||0} üye`;if(typing)return 'yazıyor…';if(partnerProfile?.showPresence===false||!partnerProfile?.lastSeenAt)return 'Özel sohbet';const seconds=Math.round(Date.now()/1000-partnerProfile.lastSeenAt.seconds);if(seconds<85)return 'çevrimiçi (yaklaşık)';return 'son etkinlik: '+new Date(partnerProfile.lastSeenAt.seconds*1000).toLocaleString('tr-TR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})},[isGroup,selected?.members.length,typing,partnerProfile]);
 const visibleMessages=useMemo(()=>messages.filter(m=>!searchText.trim()||m.text.toLocaleLowerCase('tr').includes(searchText.toLocaleLowerCase('tr'))),[messages,searchText]);
 const sortedChats=useMemo(()=>[...chats].sort((a,b)=>Number(!!prefs[b.id]?.pinned)-Number(!!prefs[a.id]?.pinned)||(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0)),[chats,prefs]);
 const onPressStart=(m:Msg)=>{if(pressTimer.current)clearTimeout(pressTimer.current);pressTimer.current=setTimeout(()=>setTargetMsg(m),500)};
 const onPressEnd=()=>{if(pressTimer.current)clearTimeout(pressTimer.current)};

 if(!configured)return <div className="setup"><div className="brandicon">H</div><h1>HUNTER <span>MESSAGE</span></h1><p>Firebase bağlantısı kurulmadı. GitHub Secrets ve README içindeki kurulum adımlarını kontrol et.</p><code>.env.example → .env</code></div>;
 if(boot)return <div className="setup">HUNTER MESSAGE yükleniyor…</div>;
 if(!user)return <main className="authpage"><section className="authcard"><div className="brandicon">H</div><h1>HUNTER <span>MESSAGE</span></h1><p>Güvenli, hızlı ve sade iletişim.</p><div className="authmodes"><button className={mode==='login'?'active':''} onClick={()=>setMode('login')}>Giriş yap</button><button className={mode==='register'?'active':''} onClick={()=>setMode('register')}>Kayıt ol</button><button className={mode==='phone'?'active':''} onClick={()=>setMode('phone')}>Telefon</button></div>{mode!=='phone'?<form onSubmit={e=>{e.preventDefault();void safe(mode==='login'?login:register)}}>{mode==='register'&&<><label>Adın</label><input value={name} onChange={e=>setName(e.target.value)} required/><label>Kullanıcı adı</label><input value={handle} onChange={e=>setHandle(e.target.value)} required/></>}<label>E-posta</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/><label>Şifre</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} required minLength={6}/><button className="primary" disabled={busy}>{mode==='login'?'Giriş yap':'Hesap oluştur'}</button></form>:<div className="phoneform"><label>Telefon (+90...)</label><input value={number} onChange={e=>setNumber(e.target.value)} placeholder="+905xxxxxxxxx"/><div id="recaptcha-container"/><button className="primary" disabled={busy} onClick={()=>void safe(sendCode)}>SMS kodu gönder</button>{confirmationId&&<><label>SMS kodu</label><input value={otp} onChange={e=>setOtp(e.target.value)}/><button className="primary" onClick={()=>void safe(verifyCode)}>Doğrula ve giriş yap</button></>}</div>}{notice&&<p className="error">{notice}</p>}<small>Bu sürümde uçtan uca şifreleme etkin değildir.</small></section></main>;
 if(!profile)return <main className="authpage"><section className="authcard"><h2>Profilini tamamla</h2><input placeholder="Ad Soyad" value={name} onChange={e=>setName(e.target.value)}/><input placeholder="kullaniciadi" value={handle} onChange={e=>setHandle(e.target.value)}/><button className="primary" disabled={busy} onClick={()=>void safe(createPhoneProfile)}>Profili kaydet</button><button className="ghost" onClick={()=>auth&&signOut(auth)}>Çıkış</button>{notice&&<p className="error">{notice}</p>}</section></main>;
 return <div className="shell">
  <aside className={'sidebar '+(active?'hide-mobile':'')}>
   <header className="top"><button type="button" className="top-profile-trigger" onClick={openSelfProfile} aria-label="Profilimi aç"><span className="avatar top-profile-avatar">{avatar(profile,profile.name)}</span></button><div className="brand">HUNTER <span>MESSAGE</span></div><button className="iconbtn" aria-label="Tema değiştir" onClick={()=>setDark(!dark)}>{dark?<Sun size={20}/>:<Moon size={20}/>}</button></header>
   <div className="nav"><button className={tab==='chats'?'active':''} onClick={()=>{setTab('chats');setActive(null)}}><MessageCircle size={18}/> Sohbetler</button><button className={tab==='people'?'active':''} onClick={()=>{setTab('people');setActive(null)}}><Users size={18}/> Kişiler</button><button className={tab==='settings'?'active':''} onClick={()=>{setTab('settings');setActive(null)}}><Settings size={18}/> Ayarlar</button></div>
   {tab==='chats'&&<><div className="panehead"><h2>Sohbetler</h2><button className="iconbtn" aria-label="Yeni sohbet" onClick={()=>setTab('people')}><Plus/></button></div><div className="chatlist">{sortedChats.length===0?<p className="muted pad">Henüz sohbet yok. Kişiler bölümünden birini bul.</p>:sortedChats.map(c=>{const other=c.members.find(id=>id!==user.uid);const label=c.kind==='group'?c.groupName||'Grup':(other&&contactProfiles[other]?.name)||c.membersInfo?.[other||'']||'Kullanıcı';return <button className={'chatitem '+(active===c.id?'chosen':'')} key={c.id} onClick={()=>{setActive(c.id);setTab('chats')}}><div className="avatar">{c.groupPhoto?<img className="group-avatar-image" src={c.groupPhoto} alt="Grup fotoğrafı"/>:c.kind==='group'?c.groupIcon||'👥':avatar(other?contactProfiles[other]:null,label)}</div><span><strong>{prefs[c.id]?.pinned&&<Pin size={12} className="inline-icon"/>}{label}{prefs[c.id]?.muted&&<BellOff size={12} className="inline-icon"/>}</strong><small>{c.kind==='group'&&c.lastMessage&&c.lastSenderId?`${c.lastSenderId===user.uid?(profile?.name||c.membersInfo[user.uid]||'Sen'):(c.membersInfo[c.lastSenderId]||'Ayrılan üye')}: ${c.lastMessage}`:(c.lastMessage||'Konuşmayı başlat')}</small></span><UnreadBadge chat={c} uid={user.uid}/></button>})}</div></>}
   {tab==='people'&&<div className="pad"><h2>Yeni sohbet</h2><button className="secondary-btn" onClick={()=>{setGroupMode(!groupMode);setFound(null)}}><Users size={17}/> {groupMode?'Birebir sohbete dön':'Yeni grup oluştur'}</button>{groupMode&&<><label className="fieldlabel">Grup adı</label><input placeholder="Örnek: Proje Ekibi" value={groupName} maxLength={80} onChange={e=>setGroupName(e.target.value)}/><label className="fieldlabel">Grup açıklaması</label><textarea className="hm-profile-input hm-profile-bio" placeholder="Grubun amacı, kuralları..." value={groupDescription} maxLength={500} onChange={e=>setGroupDescription(e.target.value)}/><label className="fieldlabel">Grup fotoğrafı (isteğe bağlı, küçük)</label><input type="file" accept="image/*" className="group-photo-input" onChange={e=>{const f=e.target.files?.[0];if(f)void compressImage(f).then(setGroupPhoto).catch(x=>setNotice(err(x)))}}/>{groupPhoto&&<img className="group-photo-preview" src={groupPhoto} alt="Grup fotoğrafı önizleme"/>}<label className="fieldlabel">Grup simgesi</label><div className="icon-options">{['👥','🐺','🔥','🎮','💬','🏠'].map(ic=><button key={ic} className={groupIcon===ic?'selected':''} onClick={()=>setGroupIcon(ic)}>{ic}</button>)}</div><p className="muted">Üyeleri kullanıcı adlarıyla bulup ekle (en fazla 29 kişi).</p>{groupUsers.map(p=><div key={p.uid} className="member-chip">{p.name}<button aria-label="Üyeyi kaldır" onClick={()=>setGroupUsers(a=>a.filter(x=>x.uid!==p.uid))}><X size={14}/></button></div>)}</>}<p className="muted">Kullanıcı adını arayarak iletişim kur.</p><div className="searchbar"><Search size={17}/><input placeholder="@kullaniciadi" value={lookup} onChange={e=>setLookup(e.target.value)} onKeyDown={e=>e.key==='Enter'&&void safe(searchPerson)}/><button onClick={()=>void safe(searchPerson)}>Ara</button></div>{found&&<button className="chatitem full" onClick={()=>{if(groupMode){if(!groupUsers.some(p=>p.uid===found.uid))setGroupUsers(p=>[...p,found]);setFound(null)}else void safe(()=>openChat(found))}}><div className="avatar">{avatar(found,found.name)}</div><span><strong>{found.name}</strong><small>@{found.username} · {groupMode?'Gruba ekle':'Sohbet başlat'}</small></span><Plus/></button>}{groupMode&&<button className="primary group-submit" onClick={()=>void safe(createGroup)} disabled={busy||!groupName.trim()||!groupUsers.length}>Grubu oluştur ({groupUsers.length+1} kişi)</button>}</div>}
   {tab==='settings'&&<div className="pad settings"><h2>Ayarlar</h2><button className="identity identity-button" type="button" onClick={openSelfProfile} aria-label="Profilimi görüntüle ve düzenle"><div className="avatar">{avatar(profile,profile.name)}</div><div><strong>{profile.name}</strong><small>@{profile.username} · Profili düzenle</small></div><Pencil size={17} className="identity-edit-icon"/></button><div className="settingrow"><UserRound size={18}/> {user.email||user.phoneNumber||'Hesap'}</div><div className="settingrow"><ShieldCheck size={18}/> Üye bazlı erişim kuralları</div><div className="settingrow"><LockKeyhole size={18}/> Uçtan uca şifreleme: henüz yok</div><button className="settingrow" onClick={()=>void safe(presenceToggle)}><CheckCircle2 size={18}/> Son görülmemi göster: {showPresence?'Açık':'Kapalı'}</button><div className="settingrow accent-setting"><span>🎨 Vurgu rengi</span><div className="accent-list">{Object.entries(accents).map(([color,v])=><button key={color} aria-label={color+' rengi'} title={color} className={accent===color?'chosen':''} onClick={()=>setAccent(color)} style={{background:v.main}}/>)}</div></div><button className="settingrow" onClick={()=>setDark(!dark)}>{dark?<Sun size={18}/>:<Moon size={18}/>} {dark?'Açık':'Koyu'} temaya geç</button><button className="settingrow danger" onClick={()=>auth&&signOut(auth)}><LogOut size={18}/> Çıkış yap</button><small className="muted">Çevrimiçi bilgisi tahminidir. PIN, gerçek push ve şifreleme henüz etkin değildir.</small></div>}
   {notice&&<div className="toast" role="alert" onClick={()=>setNotice('')}>{notice} ×</div>}
  </aside>
  <section className={'conversation '+(!active?'no-mobile':'')}>
   {selected&&active?<>
    <header className="convohead"><button className="iconbtn back" aria-label="Sohbetlere dön" onClick={()=>setActive(null)}><ArrowLeft/></button><button type="button" className="convo-profile-trigger" aria-label="Sohbet profilini aç" onClick={openConversationProfile}><span className="avatar convoavatar">{selected.groupPhoto?<img className="group-avatar-image" src={selected.groupPhoto} alt="Grup fotoğrafı"/>:isGroup?selected.groupIcon||'👥':avatar(partnerProfile,partnerName)}</span><span className="convoidentity"><strong>{isGroup?partnerName:(partnerProfile?.name||partnerName)}</strong><small className={typing?'typing-text':''}>{presenceText} <span className="version-chip">V4.3</span></small></span></button><div className="convoactions"><button className="headbtn" title="Sohbette ara" aria-label="Sohbette ara" onClick={()=>{setSearchOpen(v=>!v);setSearchText('')}}><Search size={18}/></button><button className="headbtn" title="Sesli arama (yakında)" onClick={()=>info('Sesli arama henüz bağlı değil.')}><Phone size={18}/></button><button className="headbtn" title="Görüntülü arama (yakında)" onClick={()=>info('Görüntülü arama henüz bağlı değil.')}><Video size={18}/></button><button className="headbtn" aria-label="Sohbet seçenekleri" aria-expanded={chatMenu} onClick={()=>setChatMenu(v=>!v)}><MoreVertical size={19}/></button></div>
    {chatMenu&&<div className="chat-menu"><button onClick={()=>{setChatMenu(false);openConversationProfile()}}><UserRound size={16}/> {isGroup?'Grup bilgileri':'Profili görüntüle'}</button><button onClick={()=>void safe(()=>setChatPref(active,{pinned:!selectedPref?.pinned}))}>{selectedPref?.pinned?<PinOff size={16}/>:<Pin size={16}/>} {selectedPref?.pinned?'Sabitlemeyi kaldır':'Sohbeti sabitle'}</button><button onClick={()=>void safe(()=>setChatPref(active,{muted:!selectedPref?.muted}))}>{selectedPref?.muted?<Bell size={16}/>:<BellOff size={16}/>} {selectedPref?.muted?'Sesi aç':'Sessize al'}</button><button onClick={()=>{setChatMenu(false);setSearchOpen(true)}}><Search size={16}/> Sohbette ara</button>{!isGroup&&partner&&<><button onClick={()=>void safe(toggleBlock)}><Ban size={16}/> {blockedOther?'Engeli kaldır':'Engelle'}</button><button onClick={()=>void safe(()=>reportPerson('spam'))}><Flag size={16}/> Spam bildir</button><button onClick={()=>void safe(()=>reportPerson('abuse'))}><ShieldAlert size={16}/> Taciz bildir</button></>}<button onClick={()=>{setChatMenu(false);info('Bu sürümde uçtan uca şifreleme yok.')}}><LockKeyhole size={16}/> Gizlilik bilgisi</button></div>}
    </header>
    {searchOpen&&<div className="inchat-search"><Search size={17}/><input placeholder="Sohbette mesaj ara..." value={searchText} onChange={e=>setSearchText(e.target.value)} autoFocus/><span>{visibleMessages.length} sonuç</span><button onClick={()=>{setSearchOpen(false);setSearchText('')}} aria-label="Aramayı kapat"><X size={17}/></button></div>}
    <div className="msgarea" onClick={()=>{if(chatMenu)setChatMenu(false);if(emojiOpen)setEmojiOpen(false)}}>
     {visibleMessages.length===0&&<div className="emptyconversation"><MessageCircle size={26}/><span>{searchText?'Eşleşen mesaj yok':'İlk mesajını gönder 👋'}</span></div>}
     {visibleMessages.map(m=>{
      const mine=m.senderId===user.uid;const deleted=!!m.deletedAt;const otherMembers=selected.members.filter(id=>id!==user.uid);const seen=!!(mine&&m.createdAt&&otherMembers.length&&otherMembers.every(id=>(selected.readAt?.[id]?.seconds||0)>=m.createdAt!.seconds));return <div className={'bubble-wrap '+(mine?'mine':'theirs')} key={m.id}>
       <div className={'bubble '+(mine?'mine':'theirs')+(deleted?' deleted':'')} onContextMenu={e=>{e.preventDefault();if(!deleted)setTargetMsg(m)}} onTouchStart={()=>!deleted&&onPressStart(m)} onTouchEnd={onPressEnd} onTouchMove={onPressEnd}>
        {isGroup&&<span className={'hm-group-sender '+(mine?'hm-group-sender-me':'')}>{mine?(profile?.name||selected.membersInfo[user.uid]||'Sen'):(selected.membersInfo[m.senderId]||'Ayrılan üye')}</span>}{!deleted&&<button className="bubble-more" onClick={()=>setTargetMsg(m)} title="Mesaj işlemleri" aria-label="Mesaj işlemleri"><MoreVertical size={15}/></button>}
        {m.replyTo&&!deleted&&<button className="quote" onClick={()=>info('Alıntılanan mesaj: '+m.replyTo?.text)}><strong>{m.replyTo.senderName}</strong><span>{m.replyTo.text}</span></button>}
        {deleted?<span className="deleted-msg">🚫 Bu mesaj silindi</span>:<>{m.imageData&&<button type="button" className="chat-image-open" aria-label="Fotoğrafı büyüt" onTouchStart={e=>e.stopPropagation()} onContextMenu={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();showPhoto(m.imageData||'','Sohbetteki fotoğraf')}}><img className="chat-image" src={m.imageData} alt="Gönderilen küçük fotoğraf" loading="lazy"/><span> <Search size={13}/> Büyüt</span></button>}{m.voiceData&&<div className="hm-voice-message"><span className="hm-voice-label">🎤 Sesli mesaj · {Math.max(1,m.voiceDuration||1)} sn</span><audio controls preload="none" src={m.voiceData} aria-label="Sesli mesaj oynat"/></div>}{m.text&&<span className="message-text">{m.text}</span>}</>}
        <small>{m.editedAt?'düzenlendi · ':''}{time(m.createdAt)} {mine&&(seen?<CheckCheck size={14} className="read-check"/>:<CheckCheck size={14}/>)}</small>
       </div>
       {m.reactions&&Object.values(m.reactions).length>0&&<button className="reaction-summary" onClick={()=>!deleted&&setTargetMsg(m)} title="Mesaj tepkileri">{Object.values(m.reactions).join(' ')}</button>}
      </div>;
     })}<div ref={bottom}/>
    </div>
    {targetMsg&&<div className="message-action-backdrop" onClick={()=>setTargetMsg(null)}><div className="message-actions" onClick={e=>e.stopPropagation()}><div className="message-action-head"><strong>Mesaj işlemleri</strong><button aria-label="Kapat" onClick={()=>setTargetMsg(null)}><X size={18}/></button></div><div className="reaction-picker">{['👍','❤️','😂','🔥','😮','😢'].map(e=><button key={e} onClick={()=>void safe(()=>reactTo(targetMsg,e))}>{e}</button>)}</div><button onClick={()=>chooseReply(targetMsg)}><Reply size={18}/> Cevapla (alıntı)</button>{targetMsg.senderId===user.uid&&!targetMsg.deletedAt&&<>{(!targetMsg.kind||targetMsg.kind==='text')&&targetMsg.createdAt&&Date.now()-targetMsg.createdAt.seconds*1000<15*60*1000&&<button onClick={()=>startEdit(targetMsg)}><Pencil size={18}/> Düzenle (15 dk)</button>}<button className="danger" onClick={()=>void safe(()=>deleteMessage(targetMsg))}><Trash2 size={18}/> Herkesten sil</button></>}</div></div>}
    <div className="chat-bottom">
     {reply&&<div className="reply-preview"><Reply size={17}/><span><strong>{reply.senderName}</strong><small>{reply.text}</small></span><button onClick={()=>setReply(null)} aria-label="Alıntıyı kaldır"><X size={18}/></button></div>}
     {editing&&<div className="reply-preview"><Pencil size={17}/><span><strong>Mesajı düzenliyorsun</strong><small>15 dakika içinde değişiklik yapabilirsin.</small></span><button onClick={()=>{setEditing(null);setDraft('')}} aria-label="Düzenlemeyi iptal"><X size={18}/></button></div>}
     {emojiOpen&&<div className="emoji-panel" role="dialog" aria-label="Emoji seçici"><div className="emoji-header"><strong>😄 Emojiler</strong><button className="emoji-close" aria-label="Kapat" onClick={()=>setEmojiOpen(false)}><X size={19}/></button></div><div className="emoji-search"><Search size={16}/><input placeholder="Emoji ara" value={emojiQuery} onChange={e=>setEmojiQuery(e.target.value)}/></div><div className="emoji-scroll">{Object.entries(emojiGroups).filter(([label,items])=>!emojiQuery||label.toLocaleLowerCase('tr').includes(emojiQuery.toLocaleLowerCase('tr'))||items.some(x=>x.includes(emojiQuery))).map(([label,items])=><div key={label} className="emoji-group"><div>{label}</div><div className="emoji-grid">{items.map((em,i)=><button key={em+i} onClick={()=>addEmoji(em)}>{em}</button>)}</div></div>)}</div></div>}
     {!emojiOpen&&<div className="quick-emojis">{quickEmojis.map(em=><button key={em} onClick={()=>addEmoji(em)} aria-label={'Emoji '+em}>{em}</button>)}<button className="quick-more" title="Tüm emojiler" onClick={()=>setEmojiOpen(true)}><Smile size={19}/></button></div>}
     <form className="composer" onSubmit={e=>{e.preventDefault();void safe(editing?saveEdit:send)}}><div className="composebox"><button type="button" className="compose-icon" aria-label="Emojiler" onClick={()=>setEmojiOpen(v=>!v)}><Smile size={23}/></button><textarea ref={composeInput} rows={1} value={draft} onChange={e=>typingInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(draft.trim()&&!busy)void safe(editing?saveEdit:send)}}} placeholder={blockedOther?'Engellediğin kişiye yazamazsın':'Mesaj yaz...'} maxLength={5000} disabled={blockedOther}/><input ref={fileInput} type="file" accept="image/*" className="sr-only" onChange={e=>void uploadImage(e.target.files?.[0])}/><button className="compose-icon" type="button" title="Küçük fotoğraf gönder" aria-label="Fotoğraf ekle" disabled={imageBusy||blockedOther} onClick={()=>fileInput.current?.click()}><ImagePlus size={21}/></button><VoiceRecorder key={active} disabled={imageBusy||busy||blockedOther||!!editing} onSend={sendVoiceMessage} onError={setNotice}/></div><button className="send" aria-label={editing?'Değişiklikleri kaydet':'Gönder'} disabled={!draft.trim()||busy||blockedOther}>{editing?<Check size={22}/>:<Send size={22}/>}</button></form>
     {imageBusy&&<div className="inline-info">Fotoğraf küçültülüyor ve gönderiliyor…</div>}
     {localInfo&&<div className="inline-info" role="status" onClick={()=>setLocalInfo('')}>{localInfo}<button aria-label="Kapat"><X size={15}/></button></div>}
    </div>
   </>:<div className="welcome"><div className="largeicon"><MessageCircle size={46}/></div><h2>HUNTER MESSAGE</h2><p>Sohbet seç veya kullanıcı adıyla yeni bir konuşma başlat.</p><div className="fine"><ShieldAlert size={16}/> Uçtan uca şifreleme bu sürümde yok.</div></div>}
  </section>
  {profileView&&<div className="hm-modal-backdrop" onClick={closeProfile} role="presentation"><section role="dialog" aria-modal="true" aria-label="Profil bilgileri" className="hm-profile-modal" onClick={e=>e.stopPropagation()}>
    <header className="hm-modal-title"><h2>{profileView==='self'?'Profilim':profileView==='group'?'Grup bilgileri':'Kişi profili'}</h2><button type="button" aria-label="Profili kapat" onClick={closeProfile}><X size={21}/></button></header>
    {profileView==='self'?<>
      <div className="hm-profile-hero"><button type="button" className="hm-photo-edit" onClick={()=>profilePhotoInput.current?.click()} title="Profil fotoğrafı seç" aria-label="Profil fotoğrafı yükle"><span className="hm-large-avatar">{profileEditPhoto?<img src={profileEditPhoto} alt="Profil fotoğrafı önizleme"/>:profileEditName.slice(0,1).toLocaleUpperCase('tr-TR')}</span><span className="hm-photo-edit-icon"><Pencil size={15}/></span></button><input ref={profilePhotoInput} type="file" className="sr-only" accept="image/*" onChange={e=>void chooseProfilePhoto(e.target.files?.[0])}/><strong>@{profile.username}</strong><span>Fotoğraf için dokun · küçük JPEG</span></div>
      {profileEditPhoto&&<div className="hm-photo-actions"><button onClick={()=>showPhoto(profileEditPhoto,'Profil fotoğrafım')}>Fotoğrafı görüntüle</button><button onClick={()=>setProfileEditPhoto('')}>Fotoğrafı kaldır</button></div>}
      <label className="hm-field-label">Görünen ad</label><input className="hm-profile-input" maxLength={80} value={profileEditName} onChange={e=>setProfileEditName(e.target.value)}/>
      <label className="hm-field-label">Hakkımda</label><textarea className="hm-profile-input hm-profile-bio" maxLength={160} value={profileEditBio} onChange={e=>setProfileEditBio(e.target.value)} placeholder="Kısaca kendinden bahset..."/><small className="hm-note">{profileEditBio.length}/160 · Kullanıcı adın ve hesap e-postan burada değiştirilemez.</small>
      {profileError&&<div className="hm-profile-error" role="alert">{profileError}</div>}<button type="button" className="hm-save-profile" disabled={profileSaving||profilePhotoBusy} onClick={()=>void saveProfile().catch(e=>setProfileError(err(e)))}>{profilePhotoBusy?'Fotoğraf hazırlanıyor…':profileSaving?'Kaydediliyor…':'Değişiklikleri kaydet'}</button>
    </>:profileView==='partner'?<>
      <div className="hm-profile-hero"><button type="button" className="hm-large-avatar hm-clickable-avatar" onClick={()=>partnerProfile?.photoData&&showPhoto(partnerProfile.photoData,'Profil fotoğrafı')} aria-label="Profil fotoğrafını büyüt">{avatar(partnerProfile,partnerName)}</button><strong>{partnerProfile?.name||partnerName}</strong><span>@{partnerProfile?.username||'kullanici'}</span></div>
      {partnerProfile?.bio&&<div className="hm-bio"><strong>Hakkında</strong><p>{partnerProfile.bio}</p></div>}
      <div className="hm-profile-detail"><CheckCircle2 size={17}/> {presenceText}</div>
      <div className="hm-profile-detail"><ShieldCheck size={17}/> Telefon ve e-posta bilgileri gizlenir</div>
      <button type="button" className="hm-secondary-action" onClick={()=>{setProfileView(null);void safe(toggleBlock)}}><Ban size={17}/> {blockedOther?'Engeli kaldır':'Kullanıcıyı engelle'}</button>
    </>:<>
      <div className="hm-profile-hero"><button type="button" className="hm-large-avatar hm-clickable-avatar" onClick={()=>selected?.groupPhoto&&showPhoto(selected.groupPhoto,'Grup fotoğrafı')}>{selected?.groupPhoto?<img src={selected.groupPhoto} alt="Grup fotoğrafı"/>:selected?.groupIcon||'👥'}</button><strong>{selected?.groupName||'Grup'}</strong><span>{selected?.members.length||0} üye · {selected?.adminId===user.uid?'Yöneticisin':'Üyesin'}</span></div>
      {selected?.groupDescription&&<div className="hm-bio"><strong>Grup açıklaması</strong><p>{selected.groupDescription}</p></div>}
      {selected?.adminId===user.uid&&<div className="hm-group-management">
        <strong><Pencil size={17}/> Grup bilgilerini düzenle</strong>
        <label className="hm-field-label" htmlFor="hm-group-edit-name">Grup adı</label><input id="hm-group-edit-name" className="hm-profile-input" value={groupEditName} maxLength={80} onChange={e=>setGroupEditName(e.target.value)}/>
        <label className="hm-field-label" htmlFor="hm-group-edit-desc">Grup açıklaması</label><textarea id="hm-group-edit-desc" className="hm-profile-input hm-profile-bio" placeholder="Grubun amacı, kuralları..." value={groupEditDescription} maxLength={500} onChange={e=>setGroupEditDescription(e.target.value)}/><small className="hm-note">{groupEditDescription.length}/500</small>
        <label className="hm-field-label">Grup simgesi</label><div className="icon-options">{['👥','🐺','🔥','🎮','💬','🏠'].map(ic=><button key={ic} type="button" className={groupEditIcon===ic?'selected':''} onClick={()=>setGroupEditIcon(ic)}>{ic}</button>)}</div>
        <input className="sr-only" type="file" accept="image/*" ref={groupPhotoInput} onChange={e=>void changeGroupPhoto(e.target.files?.[0])}/>
        <div className="hm-group-photo-actions"><button type="button" onClick={()=>groupPhotoInput.current?.click()}><ImagePlus size={17}/> Grup fotoğrafı seç</button>{groupEditPhoto&&<button type="button" onClick={()=>setGroupEditPhoto('')}><Trash2 size={16}/> Fotoğrafı kaldır</button>}</div>
        {groupEditPhoto&&<button type="button" className="hm-group-photo-preview" onClick={()=>showPhoto(groupEditPhoto,'Grup fotoğrafı önizleme')}><img src={groupEditPhoto} alt="Grup fotoğrafı önizleme"/> Büyüt</button>}
        <button className="hm-save-profile" type="button" disabled={groupManageBusy} onClick={()=>void manageGroupAction(saveGroupInfo)}>{groupManageBusy?'İşleniyor…':'Grup bilgilerini kaydet'}</button>
      </div>}
      <div className="hm-group-members"><strong>Üyeler ({selected?.members.length||0}/30)</strong>{selected?.members.map(id=><div key={id} className="hm-member-row"><span className="avatar">{id===user.uid?avatar(profile,profile.name):avatar(contactProfiles[id],selected.membersInfo[id]||'?')}</span><span className="hm-member-name">{id===user.uid?'Sen':selected.membersInfo[id]||'Üye'}</span>{id===selected.adminId&&<small>Yönetici</small>}{selected.adminId===user.uid&&id!==selected.adminId&&<button type="button" className="hm-member-remove" disabled={groupManageBusy} onClick={()=>void manageGroupAction(()=>removeGroupMember(id))} aria-label={`${selected.membersInfo[id]||'Üye'} kişisini gruptan çıkar`}><Trash2 size={16}/> Çıkar</button>}</div>)}</div>
      {selected?.adminId===user.uid&&<div className="hm-group-add"><strong><UserRound size={17}/> Üye ekle</strong><div className="hm-member-search"><input value={groupFindHandle} placeholder="@kullaniciadi" onChange={e=>{setGroupFindHandle(e.target.value);setGroupFoundPerson(null)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void manageGroupAction(findGroupMember)}}}/><button disabled={groupManageBusy||!groupFindHandle.trim()} onClick={()=>void manageGroupAction(findGroupMember)}><Search size={17}/> Ara</button></div>{groupFoundPerson&&<div className="hm-member-found"><div className="avatar">{avatar(groupFoundPerson,groupFoundPerson.name)}</div><div><strong>{groupFoundPerson.name}</strong><small>@{groupFoundPerson.username}</small></div><button disabled={groupManageBusy} onClick={()=>void manageGroupAction(()=>addGroupMember(groupFoundPerson))}><Plus size={17}/> Ekle</button></div>}<small className="hm-note">Üyeleri yalnızca grup yöneticisi ekleyebilir ve çıkarabilir. En fazla 30 kişi.</small></div>}
      {groupError&&<div className="hm-profile-error" role="alert">{groupError}</div>}
    </>}
  </section></div>}
  {photoViewer&&<div className="hm-lightbox" role="dialog" aria-modal="true" aria-label="Fotoğraf görüntüleyici" onClick={()=>setPhotoViewer(null)}><header className="hm-lightbox-top" onClick={e=>e.stopPropagation()}><span>{photoViewer.label}</span><button aria-label="Fotoğrafı kapat" onClick={()=>setPhotoViewer(null)}><X size={25}/></button></header><div className="hm-lightbox-stage" onClick={e=>e.stopPropagation()}><img src={photoViewer.src} alt={photoViewer.label} style={{transform:`scale(${photoZoom})`}} onClick={()=>setPhotoZoom(v=>v===1?2:1)}/></div><div className="hm-lightbox-controls" onClick={e=>e.stopPropagation()}><button aria-label="Küçült" onClick={()=>setPhotoZoom(v=>Math.max(1,+(v-.5).toFixed(1)))}>−</button><span>{Math.round(photoZoom*100)}%</span><button aria-label="Büyüt" onClick={()=>setPhotoZoom(v=>Math.min(3,+(v+.5).toFixed(1)))}>+</button></div></div>}
 </div>;
}
