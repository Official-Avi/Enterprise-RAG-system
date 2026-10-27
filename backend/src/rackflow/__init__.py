"""RackFlow AI backend: API, workers, ingestion, RAG, and operations modules."""

__version__ = "0.1.0"

# Bumped whenever extraction/cleaning/chunking/embedding behaviour changes, so indexed
# chunks can be traced back to the pipeline that produced them.
PIPELINE_VERSION = "2026.10.1"
