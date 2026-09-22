import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { createMvuConversion, cardData, applyMvuCleanup } from '../tavern-plugin/lib/domain/mvu-conversion.js'
import { buildMvuArtifacts, MVU_CONVERSION_KEY } from '../tavern-plugin/lib/domain/mvu-conversion-artifacts.js'
import { validateMvuConversion } from '../tavern-plugin/lib/domain/mvu-conversion-validation.js'
import { registerMvuConversionTools } from '../tavern-plugin/lib/domain/mvu-conversion-tools.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'

const original = () => ({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: '旅人', description: '保留的故事。每轮末尾输出状态表。', first_mes: '你站在门口。', alternate_greetings: ['你在入口。'], creator: '作者', tags: ['旅行'], character_book: { name:'原书',entries:[{id:0,keys:['城市'],content:'城市设定',comment:'原设定',enabled:true,constant:false}] }, extensions: { custom: {keep:true}, regex_scripts: [{id:'unrelated',findRegex:'/错别字/g',replaceString:'字',placement:[2],markdownOnly:true}] } } })
const definition = () => ({initialState:{玩家:{位置:'门口'},人物:{$meta:{extensible:true,template:{姓名:'',位置:'未明确',在场:true}}}},updateRules:'玩家位置只随正文确认的移动更新。',displayFields:[{path:'/玩家',label:'玩家'},{path:'/人物',label:'人物'}],cleanup:[{op:'replaceText',path:'/description',expected:'每轮末尾输出状态表。',value:''}]})
async function fixture(t, options={}) {
  const dataRoot=await mkdtemp(join(tmpdir(),'mvu-conversion-')); t.after(()=>rm(dataRoot,{recursive:true,force:true}))
  const resources=createFileResourceStore({dataRoot,...options}); await resources.ensure()
  const sourcePath=await resources.importCard({name:'旅人.json',text:JSON.stringify(original())},original())
  const conversion=createMvuConversion({resources})
  const inspect=()=>conversion.convert({action:'inspect',sourcePath,detail:'full'})
  const apply=async extra=>conversion.convert({action:'apply',sourcePath,...definition(),...(await inspect()),...extra})
  return {resources,sourcePath,conversion,inspect,apply}
}

test('转换原卡为自包含副本：隔离保存、精确清理、所有开场、绑定和运行投影',async t=>{
  const f=await fixture(t), before=await f.resources.readText(f.sourcePath)
  const result=await f.apply()
  assert.equal(result.path,'cards/旅人 MVU版本.json');assert.equal(result.validation.valid,true)
  assert.equal(await f.resources.readText(f.sourcePath),before)
  assert.deepEqual(await f.resources.worldBookBindingForCard(f.sourcePath),{kind:'default'})
  const data=cardData(await f.resources.readCard(result.path))
  assert.equal(data.extensions[MVU_CONVERSION_KEY].preservedWorldbook,undefined)
  assert.equal(data.description,'保留的故事。');assert.equal(data.creator,'作者');assert.deepEqual(data.extensions.custom,{keep:true})
  assert.equal(data.character_book.entries.length,3);assert.equal(data.character_book.entries[0].enabled,true)
  assert.equal(new Set(data.character_book.entries.map(e=>e.id)).size,3)
  for(const text of [data.first_mes,...data.alternate_greetings])assert.equal(text.split('<mvu-status/>').length,2)
  assert.equal(result.validation.checks.find(x=>x.name==='templateSimulation').status,'passed')
  assert.ok(result.validation.pending.some(x=>x.includes('真实模型')))
})

test('重复调用与并发重试不新建副本、条目或规则',async t=>{
  const f=await fixture(t), input={action:'apply',sourcePath:f.sourcePath,...definition(),...(await f.inspect())}
  const results=await Promise.all([f.conversion.convert(input),f.conversion.convert(input)])
  assert.equal(results[0].changed,true);assert.equal(results[1].changed,false)
  assert.equal((await f.resources.list('card')).length,2)
  const data=cardData(await f.resources.readCard(results[0].path));assert.equal(data.character_book.entries.length,3);assert.equal(data.extensions.regex_scripts.length,3)
})

test('改定义更新同一副本；目标版本保护手工改动',async t=>{
  const f=await fixture(t), first=await f.apply(), old=await f.inspect()
  const changed=await f.resources.readCard(first.path);cardData(changed).description='手工改动'
  await f.resources.writeWorking(first.path,JSON.stringify(changed))
  await assert.rejects(f.conversion.convert({action:'apply',sourcePath:f.sourcePath,...definition(),...old}),/目标副本已有变更/)
  const next=await f.apply({planMode:'replace',initialState:{玩家:{位置:'大厅'},人物:{}},displayFields:[]})
  assert.equal(next.path,first.path);assert.equal(next.validation.valid,true)
  assert.equal(cardData(await f.resources.readCard(next.path)).character_book.entries.length,3)
})

test('检查阶段之后原卡或外部世界书变化会拒绝写入',async t=>{
  const f=await fixture(t), inspected=await f.inspect()
  const doc=await f.resources.readCard(f.sourcePath);cardData(doc).scenario='新剧情'
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  await assert.rejects(f.conversion.convert({action:'apply',sourcePath:f.sourcePath,...definition(),...inspected}),/已变化/)
  assert.equal((await f.resources.list('card')).length,1)
})

test('原文不匹配、重叠路径、路径越界与同名原卡都不写入',async t=>{
  const f=await fixture(t)
  for(const cleanup of [
    [{op:'replaceText',path:'/description',expected:'不存在',value:''}],
    [{op:'remove',path:'/extensions/custom',expected:{keep:true}}],
    [{op:'remove',path:'/__proto__/x',expected:null}],
    [{op:'replace',path:'/description',expected:original().data.description,value:'a'},{op:'remove',path:'/description',expected:original().data.description}]
  ])await assert.rejects(f.apply({cleanup}))
  await assert.rejects(f.inspect().then(args=>f.conversion.convert({action:'apply',sourcePath:f.sourcePath,...args,...definition(),name:'旅人'})),/独立副本/)
  assert.equal((await f.resources.list('card')).length,1)
})

test('数组清理全部依据原下标且保留相邻无关项',()=>{
  const data={character_book:{entries:[{content:'旧1'},{content:'保留'},{content:'旧2'}]}}
  applyMvuCleanup(data,[{op:'remove',path:'/character_book/entries/0',expected:{content:'旧1'}},{op:'remove',path:'/character_book/entries/2',expected:{content:'旧2'}}])
  assert.deepEqual(data.character_book.entries,[{content:'保留'}])
})

test('复制真实绑定的外部世界书；保留但不启用原来的闲置内置书',async t=>{
  const f=await fixture(t)
  const book={name:'外部',entries:{7:{uid:7,key:['规则'],comment:'禁用条目',content:'保持禁用',disable:true},8:{uid:8,key:[],comment:'外部设定',content:'外部有效内容',disable:false,constant:true}}}
  const bookPath=await f.resources.importWorldBook({name:'外部.json',originalText:JSON.stringify(book)},book)
  await f.resources.bindWorldBook(f.sourcePath,bookPath)
  const oldBook=await f.resources.readText(bookPath), input=await f.inspect()
  assert.equal(input.card.character_book.entries.length,2)
  const result=await f.apply(), data=cardData(await f.resources.readCard(result.path))
  assert.equal(data.character_book.entries.length,4);assert.equal(data.character_book.entries[0].enabled,false)
  assert.equal(data.extensions[MVU_CONVERSION_KEY].preservedWorldbook.entries[0].content,'城市设定')
  assert.equal(await f.resources.readText(bookPath),oldBook)
  assert.equal((await f.resources.worldBookBindingForCard(f.sourcePath)).path,bookPath)
  book.entries[8].content='变更';await f.resources.writeWorking(bookPath,JSON.stringify(book))
  await assert.rejects(f.conversion.convert({action:'apply',sourcePath:f.sourcePath,...definition(),...input}),/已变化/)
})

test('明确不绑定的原书不会在转换后重新启用',async t=>{
  const f=await fixture(t);await f.resources.unbindWorldBook(f.sourcePath)
  const result=await f.apply(),data=cardData(await f.resources.readCard(result.path))
  assert.equal(data.character_book.entries.length,2)
  assert.equal(data.extensions[MVU_CONVERSION_KEY].preservedWorldbook.entries.length,1)
})

test('既有 MVU 和旧面板声明需要显式处理，不静默重复安装',async t=>{
  const f=await fixture(t), doc=await f.resources.readCard(f.sourcePath)
  cardData(doc).character_book.entries.push({id:5,comment:'[initvar]已有',content:'{}',enabled:false})
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  await assert.rejects(f.apply(),/已有 MVU/)
  const data=cardData(doc);data.character_book.entries.pop();data.extensions.regex_scripts.push({findRegex:'<mvu-status/>',replaceString:'old'})
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  await assert.rejects(f.apply(),/旧状态正则/)
})

test('工作区包装和资源身份保持独立',async t=>{
  const f=await fixture(t), prep=createCardPreparation({id:()=> 'source-id',now:()=>1})
  const workspace=prep.create({kind:'import',payload:{kind:'text',text:JSON.stringify(original())}})
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(workspace))
  const result=await f.apply(),copy=await f.resources.readCard(result.path)
  assert.equal(copy.kind,workspace.kind);assert.notEqual(copy.meta.id,workspace.meta.id)
  assert.equal((await f.apply()).changed,false)
})

test('写入失败时副本和绑定一起回滚，原卡未改动',async t=>{
  let fail=false
  const f=await fixture(t,{mutationFault:async({side,index})=>{if(fail&&side==='after'&&index===2){fail=false;throw Error('模拟磁盘失败')}}})
  const before=await f.resources.readText(f.sourcePath);fail=true
  await assert.rejects(f.apply(),/模拟磁盘失败/)
  assert.equal((await f.resources.list('card')).length,1)
  assert.equal(await f.resources.readText(f.sourcePath),before)
  assert.equal((await f.apply()).validation.valid,true)
})

test('验收读取磁盘：损坏的绑定、重复规则和未知脚本不误报通过',async t=>{
  const f=await fixture(t), result=await f.apply()
  await f.resources.unbindWorldBook(result.path)
  assert.equal((await f.conversion.verify({path:result.path})).valid,false)
  const doc=await f.resources.readCard(result.path),data=cardData(doc)
  data.extensions.regex_scripts.push(data.extensions.regex_scripts[1]);await f.resources.writeWorking(result.path,JSON.stringify(doc))
  const check=await f.conversion.verify({path:result.path})
  assert.equal(check.checks.find(x=>x.name==='managedPanel').status,'failed')
  assert.equal(check.checks.some(x=>x.name==='templateSimulation'),false)
})

test('展示配置按 JSON Pointer 处理转义，文本不能注入 HTML 或脚本',async()=>{
  const def={initialState:{'a/b':{'~键':'<img src=x onerror=bad()>'}},updateRules:'保持原值',displayFields:[{path:'/a~1b/~0键',label:'</script><script>throw Error(1)</script>$1{{match}}$&'}]}
  const built=buildMvuArtifacts(def)
  const checked=await validateMvuConversion({first_mes:'开始\n\n<mvu-status/>',character_book:{entries:built.entries},extensions:{regex_scripts:built.regexScripts,[MVU_CONVERSION_KEY]:{version:1,...def}}})
  assert.equal(checked.valid,true,JSON.stringify(checked))
  assert.throws(()=>buildMvuArtifacts({...def,displayFields:[{path:'/不存在'}]}),/不存在/)
})

test('两个原生工具只允许卡片工作台调用',async()=>{
  const registered=new Map(),calls=[];let mode='story'
  registerMvuConversionTools({tools:{register:tool=>registered.set(tool.name,tool)},defineTool:tool=>tool,chatForSession:async()=>({mode}),conversion:{convert:async args=>{calls.push(args);return {ok:true}},verify:async()=>({valid:true})}})
  assert.equal(registered.size,2)
  const cleanupSchema = registered.get('tavern_convert_to_mvu').parameters.cleanup.items.properties
  assert.notEqual(cleanupSchema.expected.required, true)
  assert.ok(cleanupSchema.op.enum.includes('replaceBlock'))
  await assert.rejects(registered.get('tavern_convert_to_mvu').execute({action:'inspect'},{}),/工作台/)
  mode='card';assert.equal((await registered.get('tavern_convert_to_mvu').execute({action:'inspect'},{})).report.ok,true)
  assert.equal((await registered.get('tavern_validate_mvu_conversion').execute({},{})).report.valid,true)
})

test('源卡 PNG 封面随副本保存且重复调用不覆盖原版',async t=>{
  const f=await fixture(t)
  const signature=Buffer.from([137,80,78,71,13,10,26,10]), payload=Buffer.from('chara\0'+Buffer.from(JSON.stringify(original())).toString('base64'))
  const chunk=Buffer.alloc(payload.length+12);chunk.writeUInt32BE(payload.length);chunk.write('tEXt',4);payload.copy(chunk,8)
  const end=Buffer.alloc(12);end.write('IEND',4)
  const image=Buffer.concat([signature,chunk,end])
  const sourcePath=await f.resources.importCard({kind:'png',name:'图片原卡.png',fileB64:image.toString('base64')},original())
  const input=await f.conversion.convert({action:'inspect',sourcePath,name:'图片副本'})
  const result=await f.conversion.convert({action:'apply',sourcePath,name:'图片副本',...input,...definition()})
  assert.equal(result.imageCopied,true)
  assert.deepEqual(await f.resources.readCardImage(result.path),image)
  assert.deepEqual(await f.resources.readCardImage(sourcePath),image)
})

test('多世界书 UID 冲突由原库合并，原资源均不变',async t=>{
  const f=await fixture(t)
  const book={name:'第二本',entries:{0:{uid:0,comment:'另一条',content:'第二本内容',disable:false,key:['x']}}}
  const path=await f.resources.importWorldBook({name:'第二本.json',originalText:JSON.stringify(book)},book)
  await f.resources.bindWorldBooks(f.sourcePath,[{kind:'embedded',cardPath:f.sourcePath},{kind:'standalone',path}])
  const before=await f.resources.readText(path), result=await f.apply(), entries=cardData(await f.resources.readCard(result.path)).character_book.entries
  assert.equal(entries.length,4);assert.equal(new Set(entries.map(x=>x.id)).size,4)
  assert.equal(await f.resources.readText(path),before)
})

test('专用工具使用真实 DSH 参数/输出定义', {skip:!process.env.DSH_BOOT_MODULE},async t=>{
  const {pathToFileURL}=await import('node:url')
  const {defineTool}=await import(new URL('../../dsh-tools/lib/index.js',pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const f=await fixture(t), registered=new Map()
  registerMvuConversionTools({defineTool,tools:{register:tool=>registered.set(tool.name,tool)},conversion:f.conversion,chatForSession:async()=>({mode:'card'})})
  const tool=registered.get('tavern_convert_to_mvu'), exec={agent:{session:{id:'test'}}}
  const {report:inspection}=await tool.execute({action:'inspect',sourcePath:f.sourcePath},exec)
  const {report:page}=await tool.execute({action:'read',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,path:'/first_mes',offset:0,limit:4},exec)
  assert.equal(page.text,original().data.first_mes.slice(0,4))
  const {report:preview}=await tool.execute({action:'preview',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,...definition()},exec)
  assert.equal(preview.saved,false);assert.equal(preview.validation.valid,true)
  assert.equal((await f.resources.list('card')).length,1)
  const {report:result}=await tool.execute({action:'apply',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,...definition(),cleanup:[...definition().cleanup,{op:'remove',path:'/character_book/entries/0'}]},exec)
  assert.equal(result.validation.valid,true)
  const validation=await registered.get('tavern_validate_mvu_conversion').execute({path:result.path},exec)
  assert.equal(validation.report.valid,true)
  assert.doesNotThrow(()=>JSON.stringify(tool.output.render({}, {report:result})))
})

test('大条目删除仅需路径；版本号保护原卡且保留无关大段内容', async t => {
  const f = await fixture(t), doc = await f.resources.readCard(f.sourcePath)
  const large = '保留的长篇剧情。'.repeat(3000)
  cardData(doc).scenario = large
  cardData(doc).character_book.entries.push({id:9,comment:'旧面板',content:'旧状态代码'.repeat(3000)})
  await f.resources.writeWorking(f.sourcePath, JSON.stringify(doc))
  const before = await f.resources.readText(f.sourcePath), inspection = await f.inspect()
  const args = {action:'apply',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,...definition(),cleanup:[...definition().cleanup,{op:'remove',path:'/character_book/entries/1'}]}
  assert.ok(JSON.stringify(args).length < 1000)
  const result = await f.conversion.convert(args), data = cardData(await f.resources.readCard(result.path))
  assert.equal(result.validation.valid, true)
  assert.equal(data.scenario, large)
  assert.equal(data.character_book.entries.some(e => e.id === 9), false)
  assert.equal(await f.resources.readText(f.sourcePath), before)
  cardData(doc).scenario += '新内容'
  await f.resources.writeWorking(f.sourcePath, JSON.stringify(doc))
  await assert.rejects(f.conversion.convert(args), /已变化/)
})

test('同字段多个小编辑按原文定位，不重传保留正文或长区块', () => {
  const data = {description:'剧情甲。旧短句。<旧面板>'+'代码'.repeat(5000)+'</旧面板>剧情乙。旧尾句。',scenario:'旧场景',character_book:{entries:[{content:'A'}, {content:'保留'}, {content:'B'}]}}
  const cleanup = [
    {op:'replaceText',path:'/description',expected:'旧短句。',value:''},
    {op:'remove',path:'/character_book/entries/0'},
    {op:'replaceBlock',path:'/description',start:'<旧面板>',end:'</旧面板>',value:''},
    {op:'replace',path:'/scenario',value:'新场景'},
    {op:'replaceText',path:'/description',expected:'旧尾句。',value:'新尾句。'},
    {op:'remove',path:'/character_book/entries/2'}
  ]
  applyMvuCleanup(data, cleanup)
  assert.equal(data.description, '剧情甲。剧情乙。新尾句。')
  assert.equal(data.scenario, '新场景')
  assert.deepEqual(data.character_book.entries, [{content:'保留'}])
})

test('区块边界不唯一、倒置及范围重叠都整批拒绝，旧 expected 校验仍有效', () => {
  for (const cleanup of [
    [{op:'replaceBlock',path:'/description',start:'重复',end:'尾',value:''}],
    [{op:'replaceBlock',path:'/description',start:'尾',end:'头',value:''}],
    [{op:'replaceBlock',path:'/description',start:'头',end:'缺失',value:''}],
    [{op:'replaceBlock',path:'/description',start:'头',end:'尾',value:''},{op:'replaceText',path:'/description',expected:'正文',value:''}],
    [{op:'remove',path:'/description'},{op:'replaceText',path:'/description',expected:'正文',value:''}],
    [{op:'remove',path:'/description',expected:'错误原值'}]
  ]) {
    const data = {description:'头重复正文重复尾',scenario:'原场景'}, before = structuredClone(data)
    assert.throws(() => applyMvuCleanup(data, [{op:'replace',path:'/scenario',value:'新场景'},...cleanup]))
    assert.deepEqual(data, before)
  }
})

test('增量修订持久方案：只补清理不恢复旧正则，重启后仍可重试', async t => {
  const f = await fixture(t)
  const first = await f.apply({cleanup:[...definition().cleanup,{op:'remove',path:'/extensions/regex_scripts/0'}]})
  const conversion = createMvuConversion({resources:f.resources})
  const inspection = await conversion.convert({action:'inspect',sourcePath:f.sourcePath})
  const input = {action:'apply',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,targetRevision:inspection.targetRevision,
    cleanup:[{op:'replaceText',path:'/first_mes',expected:'门口',value:'入口'}]}
  const next = await conversion.convert(input)
  assert.equal(next.path,first.path)
  const data = cardData(await f.resources.readCard(next.path))
  assert.equal(data.description,'保留的故事。')
  assert.equal(data.extensions.regex_scripts.some(r=>r.id==='unrelated'),false)
  assert.match(data.first_mes,/入口/)
  assert.equal(data.extensions[MVU_CONVERSION_KEY].cleanup.length,3)
  assert.equal((await conversion.convert(input)).changed,false)
})

test('清理定位报告区分缺失、重复边界，保留原始换行且整批不写入', () => {
  const data={first_mes:'正文\r\n<人物>A</人物><地点>甲</地点><人物>B</人物><地点>乙</地点>'}
  assert.throws(()=>applyMvuCleanup(data,[{op:'replaceBlock',path:'/first_mes',start:'<人物>A',end:'</地点>',value:''}]),error=>{
    assert.equal(error.code,'CLEANUP_ANCHOR_MISMATCH')
    assert.equal(error.details.operation,0)
    assert.equal(error.details.anchor,'end')
    assert.equal(error.details.matches,2)
    assert.equal(error.details.candidates.length,2)
    return true
  })
  assert.match(data.first_mes,/正文\r\n/)
})

test('默认检查仅返回目录；版本绑定的按需读取和搜索支持换行及多开场',async t=>{
  const f=await fixture(t), inspection=await f.conversion.convert({action:'inspect',sourcePath:f.sourcePath})
  assert.equal(inspection.card,undefined)
  assert.ok(inspection.catalog.some(x=>x.path==='/first_mes'))
  const read=await f.conversion.convert({action:'read',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,path:'/first_mes',offset:1,limit:3})
  assert.equal(read.text,original().data.first_mes.slice(1,4))
  const search=await f.conversion.convert({action:'search',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,query:'入口'})
  assert.ok(search.matches.some(x=>x.path==='/alternate_greetings/0'))
  const doc=await f.resources.readCard(f.sourcePath);cardData(doc).scenario='已改变'
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  await assert.rejects(f.conversion.convert({action:'read',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,path:'/first_mes'}),/已变化/)
})

test('验收报告真实删除项目，检查旧渲染协议残留及手工修改',async t=>{
  const f=await fixture(t), doc=await f.resources.readCard(f.sourcePath), data=cardData(doc)
  data.first_mes+='\n<旧状态>旧值</旧状态>'
  data.extensions.regex_scripts.push({id:'legacy',findRegex:'<旧状态>(.*?)</旧状态>',replaceString:'<div>$1</div>',placement:[2]})
  data.character_book.entries.push({id:8,comment:'剧情选择点',content:'保留分支',enabled:false})
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  const plan={...definition(),cleanup:[...definition().cleanup,{op:'remove',path:'/extensions/regex_scripts/1'}]}
  const preview=await f.conversion.convert({action:'preview',sourcePath:f.sourcePath,...await f.inspect(),...plan})
  assert.equal(preview.validation.checks.find(x=>x.name==='legacyResidue').status,'failed')
  assert.equal((await f.resources.list('card')).length,1)
  await assert.rejects(f.apply(plan),/旧渲染协议残留/)
  plan.cleanup.push({op:'replaceBlock',path:'/first_mes',start:'<旧状态>',end:'</旧状态>',value:''},{op:'remove',path:'/character_book/entries/1'})
  const result=await f.apply(plan)
  assert.ok(result.validation.changes.some(x=>x.path==='/character_book/entries/1'&&x.label==='剧情选择点'&&x.enabled===false))
  const copy=await f.resources.readCard(result.path);cardData(copy).scenario='非方案修改'
  await f.resources.writeWorking(result.path,JSON.stringify(copy))
  const check=await f.conversion.verify({path:result.path})
  assert.equal(check.checks.find(x=>x.name==='planIntegrity').status,'failed')
})

test('纠正方案路径、显式完整替换和版本冲突均不丢失非目标内容',async t=>{
  const f=await fixture(t)
  const first=await f.apply({cleanup:[...definition().cleanup,{op:'replaceText',path:'/first_mes',expected:'门口',value:'门外'}]})
  const inspection=await f.inspect()
  const input={action:'apply',sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,targetRevision:inspection.targetRevision,
    cleanupResetPaths:['/first_mes'],cleanup:[{op:'replaceText',path:'/first_mes',expected:'门口',value:'大厅'}]}
  const changed=await f.conversion.convert(input)
  let data=cardData(await f.resources.readCard(changed.path))
  assert.match(data.first_mes,/大厅/);assert.doesNotMatch(data.first_mes,/门外/)
  assert.equal(data.description,'保留的故事。')
  assert.equal(data.creator,'作者');assert.deepEqual(data.extensions.custom,{keep:true})
  assert.equal((await f.conversion.convert(input)).changed,false)
  await assert.rejects(f.conversion.convert({...input,cleanup:[{op:'replaceText',path:'/first_mes',expected:'门口',value:'别处'}]}),/目标副本已有变更/)
  const reset=await f.conversion.convert({action:'apply',sourcePath:f.sourcePath,...await f.inspect(),planMode:'replace',...definition()})
  data=cardData(await f.resources.readCard(reset.path))
  assert.match(data.first_mes,/门口/);assert.equal(reset.path,first.path)
})

test('新来源不能套用旧清理；旧版副本需要明确补齐完整方案',async t=>{
  const f=await fixture(t), result=await f.apply()
  let source=await f.resources.readCard(f.sourcePath);cardData(source).scenario='新增背景'
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(source))
  await assert.rejects(f.conversion.convert({action:'apply',sourcePath:f.sourcePath,...await f.inspect(),cleanup:[]}),/旧清理路径不能合并/)
  await f.apply({planMode:'replace'})
  const doc=await f.resources.readCard(result.path);delete cardData(doc).extensions[MVU_CONVERSION_KEY].cleanup
  await f.resources.writeWorking(result.path,JSON.stringify(doc))
  await assert.rejects(f.conversion.convert({action:'apply',sourcePath:f.sourcePath,...await f.inspect()}),/旧副本没有保存完整方案/)
  assert.equal((await f.apply({planMode:'replace'})).validation.valid,true)
})

test('大卡与已有副本目录保持简短，按需分页不丢换行且可读取保存方案',async t=>{
  const f=await fixture(t), doc=await f.resources.readCard(f.sourcePath)
  cardData(doc).scenario='长文\r\n'.repeat(30000)
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc));await f.apply()
  const inspection=await f.conversion.convert({action:'inspect',sourcePath:f.sourcePath,detail:'summary'})
  assert.ok(JSON.stringify(inspection).length<8000)
  const args={sourcePath:f.sourcePath,sourceRevision:inspection.sourceRevision,targetRevision:inspection.targetRevision}
  const page=await f.conversion.convert({...args,action:'read',path:'/scenario',limit:8})
  const next=await f.conversion.convert({...args,action:'read',path:'/scenario',offset:page.nextOffset,limit:8})
  assert.equal(page.text+next.text,cardData(doc).scenario.slice(0,16))
  const plan=await f.conversion.convert({...args,action:'read',scope:'plan',path:'/cleanup'})
  assert.equal(plan.catalog[0].path,'/cleanup/0')
  const search=await f.conversion.convert({...args,action:'search',query:'长文',limit:2})
  assert.equal(search.matches.length,2);assert.equal(search.total,30000)
  assert.equal(search.nextOffset,2)
  await assert.rejects(f.conversion.convert({...args,action:'read',scope:'target',targetRevision:'wrong',path:'/first_mes'}),/目标副本已有变更/)
})

test('非目标格式正则保留，不因包含标签而被误判为旧状态栏',async t=>{
  const f=await fixture(t), doc=await f.resources.readCard(f.sourcePath), data=cardData(doc)
  data.first_mes+='\n<对话>你好</对话>'
  data.extensions.regex_scripts.push({id:'dialogue',findRegex:'<对话>(.*?)</对话>',replaceString:'<b>$1</b>',placement:[2],markdownOnly:true})
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  const result=await f.apply()
  assert.equal(result.validation.valid,true)
  assert.ok(cardData(await f.resources.readCard(result.path)).extensions.regex_scripts.some(r=>r.id==='dialogue'))
})

test('工具返回结构化定位错误，preview 和 apply 均不保存失败清理',async t=>{
  const f=await fixture(t), registered=new Map()
  registerMvuConversionTools({tools:{register:x=>registered.set(x.name,x)},defineTool:x=>x,conversion:f.conversion,chatForSession:async()=>({mode:'card'})})
  const tool=registered.get('tavern_convert_to_mvu')
  for(const action of ['preview','apply']){
    const {report}=await tool.execute({action,sourcePath:f.sourcePath,...await f.inspect(),...definition(),cleanup:[{op:'replaceText',path:'/first_mes',expected:'错误片段',value:''}]},{})
    assert.equal(report.ok,false);assert.equal(report.error.code,'CLEANUP_ANCHOR_MISMATCH')
    assert.equal(report.error.matches,0);assert.equal(report.error.anchor,'expected')
  }
  assert.equal((await f.resources.list('card')).length,1)
})

test('替换整个世界书数组仍列出实际误删的禁用剧情条目',async t=>{
  const f=await fixture(t), doc=await f.resources.readCard(f.sourcePath)
  cardData(doc).character_book.entries.push({id:8,comment:'禁用的剧情分支',content:'分支设定',enabled:false})
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  const inspection=await f.inspect()
  const result=await f.apply({cleanup:[...definition().cleanup,{op:'replace',path:'/character_book/entries',value:[inspection.card.character_book.entries[0]]}]})
  assert.ok(result.validation.removedEntries.some(x=>x.label==='禁用的剧情分支'&&x.enabled===false))
  assert.ok(result.validation.preservedEntries.some(x=>x.label==='原设定'))
  assert.equal(result.validation.preservedEntries.some(x=>x.label==='禁用的剧情分支'),false)
})

test('默认底稿一次带齐短字段和开场，长字段标明续读，支持批量原文',async t=>{
  const f=await fixture(t),doc=await f.resources.readCard(f.sourcePath)
  cardData(doc).scenario='长脚本'.repeat(15000)
  await f.resources.writeWorking(f.sourcePath,JSON.stringify(doc))
  const report=await f.conversion.convert({action:'inspect',sourcePath:f.sourcePath})
  assert.equal(report.reading.fields.find(x=>x.path==='/first_mes').text,original().data.first_mes)
  assert.ok(report.reading.fields.find(x=>x.path==='/scenario').nextOffset>0)
  assert.ok(Buffer.byteLength(JSON.stringify(report.reading),'utf8')<26000)
  const batch=await f.conversion.convert({action:'read',sourcePath:f.sourcePath,sourceRevision:report.sourceRevision,paths:['/first_mes','/alternate_greetings/0']})
  assert.deepEqual(batch.readings.map(x=>x.text),[original().data.first_mes,original().data.alternate_greetings[0]])
  const root=await f.conversion.convert({action:'read',sourcePath:f.sourcePath,sourceRevision:report.sourceRevision,path:'/'})
  assert.ok(root.catalog.some(x=>x.path==='/first_mes'))
})

test('定位类型和重叠错误直接指出可修正路径及冲突操作',()=>{
  assert.throws(()=>applyMvuCleanup({character_book:{entries:[{content:'正文'}]}},[{op:'replaceText',path:'/character_book/entries/0',expected:'正文',value:''}]),e=>{
    assert.equal(e.code,'CLEANUP_TYPE_MISMATCH');assert.equal(e.details.suggestedPath,'/character_book/entries/0/content');return true
  })
  assert.throws(()=>applyMvuCleanup({first_mes:'头正文尾'},[{op:'replaceBlock',path:'/first_mes',start:'头',end:'尾',value:''},{op:'replaceText',path:'/first_mes',expected:'正文',value:''}]),e=>{
    assert.equal(e.code,'CLEANUP_OVERLAP');assert.deepEqual(e.details.operations,[0,1]);return true
  })
})

test('只剩原版资源时 inspect 和 preview 提前报告名称冲突',async t=>{
  const f=await fixture(t),result=await f.apply()
  await rm(f.resources.absolute(result.path))
  const inspection=await f.conversion.convert({action:'inspect',sourcePath:f.sourcePath})
  assert.equal(inspection.destination.available,false)
  await assert.rejects(f.conversion.convert({action:'preview',sourcePath:f.sourcePath,...inspection,...definition()}),/副本原版资源已存在/)
})

test('DSH 无损快照和输出 schema 校验覆盖已有、损坏副本与验收', {skip:!process.env.DSH_BOOT_MODULE},async t=>{
  const {pathToFileURL}=await import('node:url')
  const root=pathToFileURL(process.env.DSH_BOOT_MODULE)
  const {snapshotJsonValue}=await import(new URL('../../dsh-util-values/lib/index.js',root))
  assert.equal(snapshotJsonValue({report:{target:{error:undefined}}}),undefined,'the logged undefined-field regression is rejected at this boundary')
  const {defineTool,validateJsonSchemaValue}=await import(new URL('../../dsh-tools/lib/index.js',root))
  const f=await fixture(t),registered=new Map()
  registerMvuConversionTools({tools:{register:x=>registered.set(x.name,x)},defineTool,conversion:f.conversion,chatForSession:async()=>({mode:'card'})})
  const tool=registered.get('tavern_convert_to_mvu')
  async function check(args){
    const value=await tool.execute(args,{})
    assert.notEqual(snapshotJsonValue(value),undefined,'same lossless snapshot used by ToolRuntime')
    assert.deepEqual(validateJsonSchemaValue(tool.output.schema,value),[])
    assert.notEqual(snapshotJsonValue(tool.output.render(args,value)),undefined)
  }
  const result=await f.apply()
  await check({action:'inspect',sourcePath:f.sourcePath})
  await check({action:'inspect',sourcePath:f.sourcePath,detail:'full'})
  const validation=await registered.get('tavern_validate_mvu_conversion').execute({path:result.path},{})
  assert.notEqual(snapshotJsonValue(validation),undefined)
  await f.resources.writeWorking(result.path,'{')
  await check({action:'inspect',sourcePath:f.sourcePath,detail:'full'})
})
