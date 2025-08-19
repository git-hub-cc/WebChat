rm -rf app_bak.jar
mv app.jar app_bak.jar
mv Web-Chat-0.0.1-SNAPSHOT.jar app.jar
docker-compose down
docker-compose up -d