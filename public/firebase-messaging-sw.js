/* HUNTER MESSAGE Web Push — V4.4. No private credentials are embedded. */
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{}}catch{}
 const title=data.notification?.title||'HUNTER MESSAGE';
 const body=data.notification?.body||'Yeni mesaj';
 event.waitUntil(self.registration.showNotification(title,{body,tag:data.data?.chatId||'hunter',data:{chatId:data.data?.chatId||''}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
  const first=list[0];if(first){first.focus();first.postMessage({type:'HUNTER_OPEN_CHAT',chatId:event.notification.data?.chatId});return}
  return clients.openWindow('/');
 }));
});
