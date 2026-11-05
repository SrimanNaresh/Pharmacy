"""Deploy Ayush Pharmacy to the Contabo server with paramiko.

Touches only this app's own pieces on the server:
  /opt/projects/ayushpharma            (project folder)
  ayushpharma-frontend / -backend      (containers, compose project "ayushpharma")
  /etc/nginx/sites-available/ayushpharma.conf (+ its sites-enabled symlink)
Other apps, sites and databases are left alone.

Usage (from the project root):
  set DEPLOY_HOST=156.67.104.242
  set DEPLOY_USER=root
  set DEPLOY_PASSWORD=...
  python deploy/deploy.py            # full deploy
  python deploy/deploy.py --init-db  # also run the (re-runnable) schema script
"""
import io
import os
import sys
import tarfile
import time

import paramiko

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = 'ayushpharma'
REMOTE_DIR = f'/opt/projects/{APP}'
SUBDOMAIN = 'ayushpharma.thangaminfotech.com'
SKIP = {'node_modules', 'dist', '.git', '.claude', '__pycache__'}


def build_archive():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tar:
        for name in ['backend', 'frontend', 'deploy', 'docker-compose.yml']:
            tar.add(os.path.join(ROOT, name), arcname=name,
                    filter=lambda ti: None if set(ti.name.split('/')) & SKIP else ti)
    buf.seek(0)
    return buf


def run(ssh, cmd, check=True):
    print(f'$ {cmd}')
    _, out, err = ssh.exec_command(cmd, get_pty=True)
    for line in iter(out.readline, ''):
        print('  ' + line.rstrip())
    code = out.channel.recv_exit_status()
    e = err.read().decode().strip()
    if e:
        print('  ' + e)
    if check and code != 0:
        sys.exit(f'Command failed ({code}): {cmd}')
    return code


def main():
    host = os.environ.get('DEPLOY_HOST', '156.67.104.242')
    user = os.environ.get('DEPLOY_USER', 'root')
    password = os.environ.get('DEPLOY_PASSWORD')
    if not password:
        sys.exit('Set DEPLOY_PASSWORD first.')
    if not os.path.exists(os.path.join(ROOT, 'backend', '.env')):
        sys.exit('backend/.env is missing (copy backend/.env.example and fill it in).')

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, password=password, timeout=30)

    # Ports must be free unless they're already ours (a redeploy).
    run(ssh, "if ss -ltnp | grep -E ':(3120|5120)\\b' | grep -vq docker-proxy; then "
             "echo 'port 3120/5120 is used by something else'; exit 1; fi")

    stamp = time.strftime('%Y%m%d-%H%M%S')
    run(ssh, f'if [ -d {REMOTE_DIR} ]; then tar -czf /opt/projects/{APP}-backup-{stamp}.tgz '
             f'-C /opt/projects {APP}; fi')
    run(ssh, f'mkdir -p {REMOTE_DIR}')

    print('Uploading project...')
    sftp = ssh.open_sftp()
    sftp.putfo(build_archive(), f'/tmp/{APP}.tgz')
    sftp.close()
    run(ssh, f'tar -xzf /tmp/{APP}.tgz -C {REMOTE_DIR} && rm -f /tmp/{APP}.tgz')

    run(ssh, f'cd {REMOTE_DIR} && docker compose -p {APP} up -d --build')
    if '--init-db' in sys.argv:
        run(ssh, f'docker exec {APP}-backend node src/db/initDb.js')

    # nginx: add our own site file only, test, and back it out if the test fails.
    conf = f'/etc/nginx/sites-available/{APP}.conf'
    run(ssh, f'cp {REMOTE_DIR}/deploy/nginx-site.conf {conf} && '
             f'ln -sfn {conf} /etc/nginx/sites-enabled/{APP}.conf')
    if run(ssh, 'nginx -t', check=False) != 0:
        run(ssh, f'rm -f /etc/nginx/sites-enabled/{APP}.conf', check=False)
        sys.exit('nginx -t failed; the new site was removed again, nginx not reloaded.')
    run(ssh, 'systemctl reload nginx')

    time.sleep(5)
    run(ssh, f'docker ps --filter name={APP} --format "{{{{.Names}}}} {{{{.Status}}}}"')
    run(ssh, f'curl -sS --resolve {SUBDOMAIN}:443:127.0.0.1 https://{SUBDOMAIN}/api/health', check=False)
    run(ssh, f'curl -sS -o /dev/null -w "frontend %{{http_code}}\\n" --resolve {SUBDOMAIN}:443:127.0.0.1 https://{SUBDOMAIN}/', check=False)
    ssh.close()
    print(f'Done: https://{SUBDOMAIN}')


if __name__ == '__main__':
    main()
