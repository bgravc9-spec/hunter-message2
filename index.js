'use strict';
const {onDocumentCreated,onDocumentUpdated,onDocumentDeleted}=require('firebase-functions/v2/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
admin.initializeApp();
const db=admin.firestore();

// V4.4: Never send message body to notification providers. Avoid duplicated sends by event ID.
exports.onNewMessage=onDocumentCreated({document:'chats/{chatId}/messages/{messageId}',region:'europe-west3'},async event=>{
 const data=event.data?.data(),id=event.params.chatId;if(!data)return;
 // Basic abuse throttle: a single account cannot send >40 messages in one minute.
 // Cloud function cleanup is reactive, NOT a substitute for pre-write rate limiting / App Check.
 const minute=Math.floor(Date.now()/60000),counter=db.doc(`spamCounters/${data.senderId}_${minute}`);
 const total=await db.runTransaction(async tx=>{const snap=await tx.get(counter);const n=(snap.data()?.count||0)+1;
   tx.set(counter,{count:n,uid:data.senderId,expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+86400000)});return n;});
 if(total>40){await event.data.ref.delete();console.warn('Abuse threshold reached',data.senderId);return;}
 const chat=await db.doc(`chats/${id}`).get();if(!chat.exists)return;
 const members=chat.data().members||[];
 for(const uid of members){
  if(uid===data.senderId)continue;
  const pref=await db.doc(`users/${uid}/chatPrefs/${id}`).get();if(pref.exists&&pref.data().muted)continue;
  const snap=await db.collection(`users/${uid}/devices`).limit(20).get();
  if(snap.empty)continue;
  const tokens=snap.docs.map(d=>d.data().token).filter(x=>typeof x==='string');
  if(!tokens.length)continue;
  const payload={tokens,notification:{title:'HUNTER MESSAGE',body:'Yeni mesaj'},data:{chatId:id}};
  try{
   const result=await admin.messaging().sendEachForMulticast(payload);
   await Promise.all(result.responses.map(async(r,i)=>{if(!r.success&&['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(r.error?.code)){
    const bad=snap.docs.find(d=>d.data().token===tokens[i]);if(bad)await bad.ref.delete();
   }}));
  }catch(e){console.error('FCM error',uid,e)}
 }
});

// V4.4: Account erasure requires recent authentication; removes identity and authored messages.
// Existing conversations may retain replies or cached names; privacy review required before public launch.
exports.deleteMyAccount=onCall({region:'europe-west3',enforceAppCheck:false},async req=>{
 const uid=req.auth?.uid;if(!uid)throw new HttpsError('unauthenticated','Oturum açın.');
 const authTime=Number(req.auth.token.auth_time||0);
 if(Date.now()/1000-authTime>600)throw new HttpsError('failed-precondition','Hesabı silmek için yeniden giriş yapın (10 dakika).');
 const userRef=db.doc(`users/${uid}`),profile=await userRef.get();const uname=profile.data()?.username;
 const groups=await db.collection('chats').where('members','array-contains',uid).get();
 for(const chat of groups.docs){
  const data=chat.data();
  if(data.kind==='group'&&data.adminId===uid&&data.members.length>1){
   throw new HttpsError('failed-precondition','Önce yönettiğiniz gruplardaki yöneticiliği devredin.');
  }
 }
 // Delete messages by this user across conversations (bounded by account data volume).
 const authored=await db.collectionGroup('messages').where('senderId','==',uid).limit(10000).get();
 if(authored.size>=10000)throw new HttpsError('failed-precondition','Hesap verisi fazla; destek ekibiyle silme işlemi gereklidir.');
 const writer=db.bulkWriter();
 authored.docs.forEach(d=>writer.delete(d.ref));
 for(const chat of groups.docs){
  const data=chat.data();if(data.kind==='group'){
   const next=data.members.filter(x=>x!==uid),membersInfo={...data.membersInfo};delete membersInfo[uid];
   const memberSince={...data.memberSince};delete memberSince[uid];
   writer.update(chat.ref,{members:next,membersInfo,memberSince});
  }else{
   // Leave other user's history accessible; unlink this account and erase their messages.
   // Deleting the private chat in full would erase the other user's content.
   writer.update(chat.ref,{[`membersInfo.${uid}`]:'Silinmiş hesap'});
  }
 }
 if(uname)writer.delete(db.doc(`usernames/${uname}`));
 const ownReports=await db.collection('reports').where('reporterId','==',uid).limit(2000).get();ownReports.docs.forEach(d=>writer.delete(d.ref));
 for(const col of ['chatPrefs','blocks','devices']){
  const snap=await userRef.collection(col).get();snap.docs.forEach(d=>writer.delete(d.ref));
 }
 writer.delete(userRef);await writer.close();
 await admin.auth().deleteUser(uid);return {ok:true};
});

// Cleanup references to removed media files; not dependent on client-side deletions.
async function removeMedia(path){if(!path||typeof path!=='string'||!path.startsWith('chats/'))return;try{await admin.storage().bucket().file(path).delete({ignoreNotFound:true})}catch(e){console.error('Storage cleanup error',e)}}
exports.onMessageEdited=onDocumentUpdated({document:'chats/{chatId}/messages/{messageId}',region:'europe-west3'},async event=>{
 const before=event.data?.before.data(),after=event.data?.after.data();if(before?.mediaPath && before.mediaPath!==after?.mediaPath)await removeMedia(before.mediaPath);
});
exports.onMessageDeleted=onDocumentDeleted({document:'chats/{chatId}/messages/{messageId}',region:'europe-west3'},async event=>{await removeMedia(event.data?.data()?.mediaPath)});
