rm -rf app_bak.jar
mv app.jar app_bak.jar
mv WebChat-0.0.1-SNAPSHOT.jar app.jar
docker compose down
docker compose up -d