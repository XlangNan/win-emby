# 国内镜像：基础镜像走 DaoCloud，pip 走清华源
FROM docker.m.daocloud.io/library/python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
COPY app.py .
ENV DATA_DIR=/data PORT=8765
VOLUME /data
EXPOSE 8765
CMD ["gunicorn", "-b", "0.0.0.0:8765", "-w", "2", "--threads", "4", "app:app"]
