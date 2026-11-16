"""Incremental website refresh; existing resources stay in the cache.

Reads new home entries immediately and reconciles cached entries at least
every 24 hours. GitHub Actions provides NOTION_TOKEN via repository secret.
"""
import runpy
runpy.run_path('sync.py', run_name='__main__')
