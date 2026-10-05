FROM mambaorg/micromamba:2.9.0
COPY --chown=$MAMBA_USER:$MAMBA_USER environment.yml /tmp/environment.yml
RUN micromamba install -y -n base -f /tmp/environment.yml && micromamba clean --all --yes
WORKDIR /app
COPY --chown=$MAMBA_USER:$MAMBA_USER . /app
ARG MAMBA_DOCKERFILE_ACTIVATE=1
ENV QT_QPA_PLATFORM=offscreen PYTHONDONTWRITEBYTECODE=1
RUN mkdir -p /app/data
RUN python -m unittest discover -s tests -p 'test_*.py' -v
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/session',timeout=8)"
CMD ["python", "server.py", "--host", "0.0.0.0", "--port", "8080"]
