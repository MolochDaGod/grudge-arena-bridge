#!/bin/bash
sed -i 's/port="8080" protocol/port="8080" address="0.0.0.0" protocol/' /etc/tomcat9/server.xml
grep "8080" /etc/tomcat9/server.xml
pkill -f catalina 2>/dev/null
sleep 2
guacd -b 0.0.0.0 -l 4822 -L info 2>/dev/null
export CATALINA_HOME=/usr/share/tomcat9
export CATALINA_BASE=/var/lib/tomcat9
export GUACAMOLE_HOME=/etc/guacamole
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
mkdir -p /var/lib/tomcat9/logs /var/lib/tomcat9/temp /var/lib/tomcat9/work
exec /usr/share/tomcat9/bin/catalina.sh run
