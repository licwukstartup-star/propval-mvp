from slowapi import Limiter
from slowapi.util import get_remote_address

# Mandate S2.3: 120/min authenticated (default), 60/min unauthenticated
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
