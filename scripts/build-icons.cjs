// Render the repository's vector icon, then let electron-builder create native containers.
// Requires the existing Electron, Playwright and electron-builder development dependencies.
const {_electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path');
(async()=>{
  const root=path.resolve(__dirname,'..'),directory=path.join(root,'desktop/icons');
  const svg=await fs.readFile(path.join(directory,'icon.svg'),'utf8');
  let app;
  try{
    app=await _electron.launch({args:[path.join(__dirname,'icon-renderer.cjs')],timeout:60000});
    const page=await app.firstWindow();
    await page.setContent('<style>html,body{margin:0;background:transparent}svg{display:block}</style>'+svg);
    await page.screenshot({path:path.join(directory,'icon.png'),omitBackground:true});
  }finally{await app?.close();}
  const {convertIcon}=require('app-builder-lib/out/util/iconConverter');
  for(const format of ['ico','icns'])await convertIcon({sources:[path.join(directory,'icon.png')],fallbackSources:[],roots:[directory],format,outDir:directory});
})().catch(error=>{console.error(error);process.exitCode=1;});
