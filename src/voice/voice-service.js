'use strict';
// Stable entry point: synthesis routes through provider adapters; playback remains shared.
const local=require('./providers/voxcpm2');
module.exports={...local,createVoiceService:require('./provider-service').createVoiceService};
