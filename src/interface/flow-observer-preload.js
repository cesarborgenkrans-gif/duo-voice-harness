const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('flowObserver',{
 read:()=>ipcRenderer.invoke('flow-observer-read'),
 onState:callback=>{const listener=(_e,value)=>callback(value);ipcRenderer.on('flow-observer-state',listener);return()=>ipcRenderer.removeListener('flow-observer-state',listener);}
});
