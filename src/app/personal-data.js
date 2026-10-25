'use strict';
// Rule: use only Duo-owned paths; never discover or migrate sibling app data.
const path=require('node:path');
function personalPaths({appRoot,userData,env=process.env}) {
  const root=path.resolve(env.DUO_VOICE_DATA_ROOT||userData||path.join(appRoot,'.local-data'));
  return {application:path.resolve(appRoot),root,worktrees:path.join(root,'worktrees'),workroom:path.join(root,'workroom')};
}
module.exports={personalPaths};
