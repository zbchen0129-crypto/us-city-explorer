"""Create a fresh, reviewed-source-only package, never copy Git history or evidence."""
from pathlib import Path
import tarfile,hashlib,json,re
root=Path(__file__).resolve().parents[1]
required=['README.md','compose.yaml','.gitignore','.github/workflows/ci.yml','data/regions.json','data/cities.json','data/cities-manifest.json','scripts/prepare-cities.py','scripts/prepare-release.py']
for d,names in {
 'project_backend':['package.json','package-lock.json','server.js','database.js','import-cities.js','cities.js','density.js','search.js','evaluate-search.js','sql/001-cities.sql','test/api.test.js','test/cities.test.js','test/density.test.js','test/search.test.js'],
 'project_frontend':['package.json','package-lock.json','index.html','vite.config.mjs','eslint.config.mjs','.env.example','src/App.vue','src/main.js','src/maps.js','src/cities.js'],
}.items():required.extend(d+'/'+n for n in names)
files=sorted(required)
for relative in files:
 raw=(root/relative).read_bytes()
 if re.search(rb'AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[0-9A-Za-z]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',raw):raise RuntimeError('Potential credential detected in '+relative)
 if str(Path.home()).encode()+b'/' in raw or re.search(rb'[\w.+-]+@uchicago[.]edu',raw):raise RuntimeError('Private machine metadata detected in '+relative)
out=root/'releases';out.mkdir(exist_ok=True)
archive=out/'us-city-explorer-source.tar.gz'
with tarfile.open(archive,'w:gz') as bundle:
 for relative in files:bundle.add(root/relative,arcname='us-city-explorer/'+relative)
manifest={'files':[{'path':s,'sha256':hashlib.sha256((root/s).read_bytes()).hexdigest()} for s in files],'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'excluded':['original Git history','historical evidence','unknown-license boundaries','local database','environment files with values','node_modules','dist','career facts'],'scan':'Credential pattern and private-metadata scan passed; heuristic check, not a guarantee','published':False}
(out/'release-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'archive':str(archive),'files':len(files),'bytes':archive.stat().st_size,'published':False}))
