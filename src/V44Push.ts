import {Capacitor} from '@capacitor/core';
import {doc,setDoc,serverTimestamp, type Firestore} from 'firebase/firestore';
import {getApp} from 'firebase/app';

// Only explicitly requested by the logged-in user. Token is stored in their private device subcollection.
export async function enablePush(db:Firestore,uid:string,onTap?:(chatId:string)=>void){
 const save=async(token:string,platform:string)=>{
  const data=new TextEncoder().encode(token);const digest=await crypto.subtle.digest('SHA-256',data);
  const key=Array.from(new Uint8Array(digest)).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('');
  await setDoc(doc(db,'users',uid,'devices',key),{token,platform,updatedAt:serverTimestamp()});
 };
 if(Capacitor.getPlatform()==='android'){
  const {PushNotifications}=await import('@capacitor/push-notifications');
  const p=await PushNotifications.requestPermissions();if(p.receive!=='granted')throw Error('Bildirim izni verilmedi.');
  await PushNotifications.addListener('registration',e=>{void save(e.value,'android')});
  await PushNotifications.addListener('registrationError',e=>console.error('Push token',e.error));
  await PushNotifications.addListener('pushNotificationActionPerformed',e=>{
   const id=e.notification.data?.chatId;if(typeof id==='string')onTap?.(id);
  });
  await PushNotifications.register();
  return 'Android bildirim kaydı başlatıldı. Firebase Android uygulaması ve google-services.json gereklidir.';
 }
 if(!('serviceWorker'in navigator)||!('Notification'in window))throw Error('Bu tarayıcı bildirimleri desteklemiyor.');
 if(!import.meta.env.VITE_FIREBASE_VAPID_KEY)throw Error('GitHub Secrets: VITE_FIREBASE_VAPID_KEY eklenmeli.');
 const perm=await Notification.requestPermission();if(perm!=='granted')throw Error('Bildirim izni verilmedi.');
 const sw=await navigator.serviceWorker.register('/firebase-messaging-sw.js');
 const {getMessaging,isSupported,getToken}=await import('firebase/messaging');
 if(!await isSupported())throw Error('Tarayıcı FCM desteklemiyor.');
 const token=await getToken(getMessaging(getApp()),{vapidKey:import.meta.env.VITE_FIREBASE_VAPID_KEY,serviceWorkerRegistration:sw});
 if(!token)throw Error('FCM token alınamadı.');
 await save(token,'web');return 'Web bildirimi bu cihaz için kaydedildi. Sunucu işlevinin de yayımlanması gerekiyor.';
}
