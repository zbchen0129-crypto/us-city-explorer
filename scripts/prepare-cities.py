"""Download GeoNames cities500, retain US populated places, record provenance."""
from pathlib import Path
import urllib.request,zipfile,io,json,hashlib,datetime
root=Path(__file__).resolve().parents[1]
url='https://download.geonames.org/export/dump/cities500.zip'
raw=urllib.request.urlopen(url,timeout=60).read()
rows=[]; rejected=[]
with zipfile.ZipFile(io.BytesIO(raw)) as archive:
 for line_number,line in enumerate(archive.read('cities500.txt').decode('utf-8').splitlines(),1):
  cells=line.split('\t')
  if len(cells)!=19:
   rejected.append({'line':line_number,'reason':'column count'});continue
  if cells[8]!='US' or cells[6]!='P':continue
  try:
   row={'id':int(cells[0]),'name':cells[1],'state':cells[10], 'latitude':float(cells[4]),'longitude':float(cells[5]),'population':int(cells[14]),'modified':cells[18]}
   assert row['id']>0 and row['name'] and -90<=row['latitude']<=90 and -180<=row['longitude']<=180 and row['population']>=0
   rows.append(row)
  except (ValueError,AssertionError):rejected.append({'line':line_number,'reason':'invalid record'})
rows.sort(key=lambda r:r['id'])
assert rows and len({r['id'] for r in rows})==len(rows)
output=json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode()
(root/'data/cities.json').write_bytes(output)
manifest={'source':url,'sourceReadme':'https://download.geonames.org/export/dump/readme.txt','license':'CC BY 4.0','attribution':'GeoNames (https://www.geonames.org/), filtered and transformed to US populated-place records','retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'archiveSha256':hashlib.sha256(raw).hexdigest(),'outputSha256':hashlib.sha256(output).hexdigest(),'records':len(rows),'rejected':rejected,'scope':'US country-code P-class records in cities500; not all incorporated cities or all US territories'}
(root/'data/cities-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'records':len(rows),'rejected':len(rejected)}))
