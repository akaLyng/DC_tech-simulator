# Commands

Every command the game's consoles understand. All of them are simulated: nothing you type is ever executed, and output comes from the ticket's state in memory.

| Kind | Meaning |
| --- | --- |
| **Real** | Exists on a real system with this syntax and does the same job. The game only shows the part of the output the ticket needs. |
| **Simplified** | Exists in real life, but the game's version behaves differently in a way that matters. |
| **Fictional** | Made up for the game. |

In the game, simplified and fictional commands are tagged **[game]** in `help`, `Get-Help`, `Get-Command`, the guide's command chips and the laptop's Tools list. The tags come from `src/commandKinds.js` (server consoles) and the `kind` / `ALIAS_KINDS` fields in `src/customer/laptop.js` (laptop). Update those and this file together.

## Server consoles (Linux)

`sudo` in front works as on a real server: commands that change the system say "Permission denied" without it.

| Command | Kind | Tickets | Description |
| --- | --- | --- | --- |
| `ip a` / `ip addr [show] [eth0]` | Real | Host offline, DNS, Static IP | Show network interfaces and their IP addresses |
| `ip link [show] [eth0]` | Real | Host offline | Show whether the network link is up |
| `ip route` / `ip r` | Real | Host offline, DNS, Static IP | Show the routing table and default gateway |
| `sudo ip addr add\|del <ip>/24 dev eth0` | Real | Static IP | Add or remove an IP address by hand (until reboot) |
| `sudo ip route add default via <gw>` | Real | Static IP | Set the default gateway by hand (until reboot) |
| `sudo dhclient [-v] [eth0]` | Real | Host offline | Ask the DHCP server for an address |
| `ping [-c N] <host>` | Real | Host offline, DNS, Static IP | Send ICMP echo requests to test reachability |
| `dig <name>` / `nslookup <name>` / `host <name>` | Real | DNS | Look a name up in DNS |
| `cat /etc/resolv.conf` | Real | DNS | Show which DNS server the machine uses |
| `echo "nameserver X" \| sudo tee /etc/resolv.conf` | Real | DNS | Write a new DNS server into resolv.conf |
| `sudo apt update` | Real | DNS | Refresh package lists (a quick test that names resolve) |
| `systemctl status <service>` | Real | Disk full, Firewall | Show whether a service is running and its last log lines |
| `sudo systemctl restart\|start <service>` | Real | Disk full | Restart or start a service |
| `journalctl -u <service> [-n N]` | Real | Disk full | Show a service's log |
| `df [-h]` | Real | Disk full | Show free space per filesystem |
| `du -sh <path>` | Real | Disk full | Show how much space a folder uses |
| `ls [-l\|-lh\|-la] [dir]` | Real | All | List files |
| `tail [-n N] <file>` | Real | Disk full | Show the end of a file |
| `sudo truncate -s 0 <file>` | Real | Disk full | Empty a file without deleting it (safe for open logs) |
| `sudo rm [-f] <file>` | Real | Disk full | Delete a file (the game explains why `truncate` is safer for a log a program still has open) |
| `docker ps [-a]` | Real | Dashboard | List running (or all) containers |
| `docker logs <name>` / `docker compose logs` | Real | Dashboard | Show a container's log |
| `docker compose up [-d]` / `docker start <name>` | Real | Dashboard | Start the containers |
| `sudo ss -tulpn` / `ss -tlnp` / `netstat -tulpn` | Real | Dashboard, Firewall | Show listening ports (and, with sudo, which program owns them) |
| `cat <file>` | Real | Several | Print a file (docker-compose.yml, netplan config, /proc/mdstat...) |
| `sed -i 's/old/new/' <file>` | Real | Dashboard, Static IP | Replace text in a file in place |
| `kill [-9\|-15] <pid>` | Real | Dashboard | Stop a process |
| `curl [-s\|-I] <url>` | Real | Dashboard, Firewall | Fetch a web page (or just its headers) |
| `cat /proc/mdstat` | Real | RAID | Show software-RAID status |
| `sudo mdadm --detail /dev/md0` | Real | RAID | Show a RAID array and its member disks |
| `sudo mdadm /dev/md0 --fail\|--remove\|--add /dev/sdX` | Real | RAID | Mark a disk failed, take it out of the array, or add a new one |
| `sudo smartctl -a\|-H\|-i /dev/sdX` | Real | RAID | Read a disk's SMART health data |
| `lsblk` | Real | RAID | List disks and partitions |
| `ls /etc/netplan` | Real | Static IP | List the network config files |
| `sudo netplan apply\|try` | Real | Static IP | Apply the network config (`try` rolls back if you lose access) |
| `sudo ufw status [verbose\|numbered]` | Real | Firewall | Show the firewall rules |
| `sudo ufw allow <port/proto\|service>` | Real | Firewall | Open a port in the firewall |
| `sudo ufw enable\|disable` | Real | Firewall | Turn the firewall on or off |
| `<command> \| grep [-i] <text>` | Real | All | Keep only the lines that contain the text |
| `whoami`, `hostname`, `pwd`, `uptime`, `date`, `history` | Real | All | Current user, machine name, folder, uptime, date, command history |
| `clear`, `exit` / `logout` | Real | All | Clear the screen; close the console |
| `client curl` / `test from client` | Fictional | Firewall | Run curl from a customer's machine instead of the server. In real life you'd run `curl` on another computer |
| `help` | Simplified | All | Lists the commands this ticket understands. Bash's real `help` lists shell builtins |
| `hint` | Fictional | All | Shows the next step of the guide |
| `reset` | Fictional | All | Restarts the ticket from scratch. The real `reset` only reinitialises the terminal |

## Management controller (the "won't boot" ticket)

The game's controller is a generic stand-in for Dell iDRAC or HPE iLO. Its short commands are made up; the real-world equivalent is in each description.

| Command | Kind | Description |
| --- | --- | --- |
| `power [status]` | Fictional | Show whether the server is powered on. Real: `ipmitool chassis power status` or `racadm serveraction powerstatus` |
| `power cycle\|reset\|restart` | Fictional | Turn the server off and on again. Real: `ipmitool chassis power cycle` |
| `console` | Fictional | Watch the server's screen as it boots. Real: the iDRAC/iLO virtual console or `ipmitool sol activate` |
| `logs` / `sel` / `event log` | Fictional | Show the hardware event log. Real: `ipmitool sel list` |
| `racadm getsel` | Real | Show the hardware event log on a Dell iDRAC |
| `boot [list]` | Fictional | Show the boot order. Real: BIOS/UEFI setup or the controller's web UI |
| `boot order\|first\|set disk1` | Fictional | Boot from the OS disk first. Real: `ipmitool chassis bootdev disk`, BIOS setup or the web UI |

## Helpdesk laptop (PowerShell)

| Command | Kind | Description |
| --- | --- | --- |
| `Test-Connection <host> [-Count N]` | Real | Ping a computer |
| `Test-NetConnection <host> [-Port N] [-TraceRoute]` | Real | Ping, test a TCP port, or trace the route |
| `Resolve-DnsName <name> [-Server ip] [-Type t]` | Real | Look a name up in DNS |
| `Get-NetIPConfiguration` | Real | Show the laptop's IP, gateway and DNS server |
| `Get-Help [<name>] [-Examples]` | Real | Show help for a command, or list them all |
| `Get-Command` | Real | List the available commands |
| `<command> \| Select-String <text>` | Real | Keep only matching lines (case-insensitive) |
| `Get-Location`, `Get-ChildItem`, `Get-Content <file>` | Real | Current folder, list files, print a file (there's a `runbook.txt`) |
| `Clear-Host`, `whoami`, `hostname`, `exit` | Real | Clear the screen, signed-in user, laptop name, close PowerShell |
| `Get-CustomerLine -Id CU-…` | Fictional | A customer's line, router, LAN clients, web filter and hosted server |
| `Get-DhcpLease -Customer CU-…` | Fictional | Whether our DHCP gave the customer's router an address. The real DHCP Server module has `Get-DhcpServerv4Lease`, for your own DHCP servers |
| `Restart-CustomerCpe -Id CU-…` | Fictional | Restart a customer's router remotely |

### Laptop aliases

| Alias | Kind | Description |
| --- | --- | --- |
| `tnc` | Real | Short for `Test-NetConnection` |
| `help`, `man` | Real | Short for `Get-Help` |
| `gcm` | Real | Short for `Get-Command` |
| `sls` | Real | Short for `Select-String` |
| `pwd`, `ls`, `dir`, `cat`, `type`, `gc` | Real | Short for `Get-Location`, `Get-ChildItem` and `Get-Content` |
| `cls`, `clear` | Real | Short for `Clear-Host` |
| `ping` | Simplified | Runs `Test-Connection`. On real Windows it's `ping.exe`, with different output |
| `nslookup` | Simplified | Runs `Resolve-DnsName`. On real Windows it's `nslookup.exe` |
| `ipconfig` | Simplified | Runs `Get-NetIPConfiguration`. On real Windows it's `ipconfig.exe` |
| `findstr` | Simplified | Works like `Select-String` after a pipe. On real Windows it's `findstr.exe`, with its own options |
| `\| grep <text>` | Simplified | Accepted after a pipe like `Select-String`. Windows has no `grep` |

## Not commands

Physical jobs (reseating a cable, swapping a disk, PSU or SFP) are done in the world with E, not typed. In the two console tickets that have one, typing `reseat cable` or `swap disk` only tells you which rack to walk to.
