import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import os from 'node:os';import path from 'node:path'
import {prepareDesktopPackageManager} from '../bin/desktop-package-manager.mjs'
test('CLI and non-Windows Desktop never provision a package runtime',async()=>{
 for(const [host,platform] of [['cli','win32'],['desktop','linux'],['desktop','darwin'],['android','win32']])assert.equal(await prepareDesktopPackageManager({host,platform,fetch(){throw Error('network must not run')}}),null)
})
test('Windows Desktop rejects unverified downloaded executables',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'desktop-package-'))
 try{
 const entry=path.join(home,'pnpm.mjs');await writeFile(entry,'')
 await assert.rejects(prepareDesktopPackageManager({host:'desktop',platform:'win32',arch:'x64',home,entry,fetch:async()=>new Response('not-node')}),/SHA-256/)
 }finally{await rm(home,{recursive:true,force:true})}
})
