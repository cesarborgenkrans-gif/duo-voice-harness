'use strict';
// Explicit-start, single-use loopback grant restricted to the app's main frame.
function registerConversationMedia({session,desktopCapturer,getWindow,validateOwner=()=>false,ttlMs=15000}){let armed=null;
  function arm(owner){if(!validateOwner(owner))throw new Error('Audio capture owner is unavailable.');armed={owner,until:Date.now()+ttlMs};return {ok:true,source:'system',warning:'System audio may include other applications.'};}
  session.setDisplayMediaRequestHandler(async(request,callback)=>{const grant=armed;armed=null;const win=getWindow();const frame=request.frame;if(!grant||Date.now()>grant.until||!validateOwner(grant.owner)||!win||frame!==win.webContents.mainFrame){callback({});return;}try{const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:0,height:0}});if(!sources.length){callback({});return;}callback({video:sources[0],audio:'loopback'});}catch{callback({});}});
  return {arm,disarm(owner){if(!owner||armed?.owner===owner)armed=null;},capability(){return {available:process.platform==='win32',source:'system',description:'Windows system audio; may include every playing application.'};},dispose(){armed=null;session.setDisplayMediaRequestHandler(null);}};
}
module.exports={registerConversationMedia};
