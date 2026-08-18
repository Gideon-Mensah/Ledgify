import json,logging
from datetime import datetime,timezone
class JSONFormatter(logging.Formatter):
 def format(self,record):return json.dumps({"timestamp":datetime.now(timezone.utc).isoformat(),"level":record.levelname,"module":record.name,"message":record.getMessage()},default=str)
