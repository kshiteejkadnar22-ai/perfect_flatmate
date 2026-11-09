#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <vector>
#include "httplib.h"
#include "nlohmann/json.hpp"
#include <cstdlib>

using json = nlohmann::json;
using namespace std;

struct Preferences {
    string city="Pune"; int budget=12000;
    string sleepTime="23:00", wakeTime="07:00", cleanliness="Very clean";
    string socialLifestyle="Quiet", smoking="No", foodPreference="Vegetarian";
    string guests="Occasionally", studyWork="Mostly evenings", roomSharing="Private room preferred";
    vector<string> keywords;

    static Preferences fromJson(const json& j) {
        Preferences p;
        p.city=j.value("city",p.city); p.budget=j.value("budget",p.budget);
        p.sleepTime=j.value("sleepTime",p.sleepTime); p.wakeTime=j.value("wakeTime",p.wakeTime);
        p.cleanliness=j.value("cleanliness",p.cleanliness); p.socialLifestyle=j.value("socialLifestyle",p.socialLifestyle);
        p.smoking=j.value("smoking",p.smoking); p.foodPreference=j.value("foodPreference",p.foodPreference);
        p.guests=j.value("guests",p.guests); p.studyWork=j.value("studyWork",p.studyWork);
        p.roomSharing=j.value("roomSharing",p.roomSharing);
        if(j.contains("keywords") && j["keywords"].is_array()) p.keywords=j["keywords"].get<vector<string>>();
        return p;
    }
    json toJson() const {
        return {{"city",city},{"budget",budget},{"sleepTime",sleepTime},{"wakeTime",wakeTime},
        {"cleanliness",cleanliness},{"socialLifestyle",socialLifestyle},{"smoking",smoking},
        {"foodPreference",foodPreference},{"guests",guests},{"studyWork",studyWork},
        {"roomSharing",roomSharing},{"keywords",keywords}};
    }
};

struct User {
    int id=0; string name,email,password,bio; Preferences preferences; bool hasProfile=false;
    set<int> liked;
    json publicJson() const {
        return {{"id",id},{"name",name},{"email",email},{"bio",bio},
                {"preferences",preferences.toJson()},{"hasProfile",hasProfile}};
    }
    json storageJson() const {
        json likes=json::array(); for(int x:liked) likes.push_back(x);
        return {{"id",id},{"name",name},{"email",email},{"password",password},{"bio",bio},
                {"preferences",preferences.toJson()},{"hasProfile",hasProfile},{"liked",likes}};
    }
    static User fromStorage(const json& j) {
        User u; u.id=j.value("id",0); u.name=j.value("name",""); u.email=j.value("email","");
        u.password=j.value("password",""); u.bio=j.value("bio","");
        if(j.contains("preferences")) u.preferences=Preferences::fromJson(j["preferences"]);
        u.hasProfile=j.value("hasProfile",false);
        if(j.contains("liked") && j["liked"].is_array()) for(auto& x:j["liked"]) u.liked.insert(x.get<int>());
        return u;
    }
};

class UserRepository {
    vector<User> accounts;
    vector<User> demoProfiles;
    string accountFile, likesFile;
    mutable mutex mtx;

    void saveAccounts() const {
        json a=json::array(); for(const auto& u:accounts) a.push_back(u.storageJson());
        ofstream out(accountFile); if(!out) throw runtime_error("Cannot save local accounts.json"); out<<a.dump(2);
    }
    void saveLikes() const {
        json a=json::array();
        for(const auto& u:accounts) for(int id:u.liked) a.push_back({{"from",u.id},{"to",id}});
        ofstream out(likesFile); if(!out) throw runtime_error("Cannot save likes.json"); out<<a.dump(2);
    }
    void loadDemo() {
        ifstream in("demo_profiles.json");
        if(!in) throw runtime_error("Cannot open demo_profiles.json. Keep it beside main.cpp and run the server from this folder.");
        json data; in>>data;
        for(const auto& row:data) {
            User u; u.id=row.at("id").get<int>(); u.name=row.at("name").get<string>();
            u.email=row.at("email").get<string>(); u.bio=row.value("bio","");
            u.preferences=Preferences::fromJson(row.at("preferences")); u.hasProfile=true;
            demoProfiles.push_back(u);
        }
        if(demoProfiles.size()!=100) throw runtime_error("Demo dataset must contain exactly 100 profiles.");
    }
    void seedDemoLogin() {
        // The demo login is preconfigured so the user can go straight to Discover.
        // Existing local accounts from earlier builds are upgraded if their profile was incomplete.
        for(auto& u:accounts) {
            if(u.email=="aarav@example.com") {
                u.name="Aarav Mehta";
                if(u.password.empty()) u.password="demo123";
                if(!u.hasProfile) {
                    u.bio="Computer science student looking for a calm, respectful flatmate.";
                    u.preferences.city="Pune";
                    u.preferences.budget=12000;
                    u.preferences.sleepTime="23:00";
                    u.preferences.wakeTime="07:00";
                    u.preferences.cleanliness="Very clean";
                    u.preferences.socialLifestyle="Quiet";
                    u.preferences.smoking="No";
                    u.preferences.foodPreference="Vegetarian";
                    u.preferences.guests="Occasionally";
                    u.preferences.studyWork="Mostly evenings";
                    u.preferences.roomSharing="Private room preferred";
                    u.preferences.keywords={"Early sleeper","Study focused","Clean","No parties"};
                    u.hasProfile=true;
                }
                saveAccounts();
                return;
            }
        }
        User u; u.id=1; u.name="Aarav Mehta"; u.email="aarav@example.com";
        u.password="demo123"; u.bio="Computer science student looking for a calm, respectful flatmate.";
        u.preferences.city="Pune"; u.preferences.budget=12000;
        u.preferences.sleepTime="23:00"; u.preferences.wakeTime="07:00";
        u.preferences.cleanliness="Very clean"; u.preferences.socialLifestyle="Quiet";
        u.preferences.smoking="No"; u.preferences.foodPreference="Vegetarian";
        u.preferences.guests="Occasionally"; u.preferences.studyWork="Mostly evenings";
        u.preferences.roomSharing="Private room preferred";
        u.preferences.keywords={"Early sleeper","Study focused","Clean","No parties"};
        u.hasProfile=true; accounts.push_back(u); saveAccounts();
    }
    void seedIshitaLogin() {
        for (const auto& existing : accounts) if (existing.email == "ishita@example.com") return;
        User u; u.id=2; u.name="Ishita Shah"; u.email="ishita@example.com"; u.password="demo123";
        u.bio="Design student who enjoys a tidy and friendly home.";
        u.preferences.city="Pune"; u.preferences.budget=15000;
        u.preferences.sleepTime="22:30"; u.preferences.wakeTime="06:30";
        u.preferences.cleanliness="Moderately clean"; u.preferences.socialLifestyle="Occasionally social";
        u.preferences.smoking="No"; u.preferences.foodPreference="Vegetarian";
        u.preferences.guests="Occasionally"; u.preferences.studyWork="Mostly evenings";
        u.preferences.roomSharing="Private room preferred";
        u.preferences.keywords={"Clean","Social","Study focused"};
        u.hasProfile=true; accounts.push_back(u); saveAccounts();
    }
public:
    UserRepository(string a="accounts.json",string l="likes.json"):accountFile(a),likesFile(l) {
        loadDemo();
        ifstream in(accountFile);
        if(in) { try { json a; in>>a; for(const auto& x:a) accounts.push_back(User::fromStorage(x)); } catch(...) { accounts.clear(); } }
        seedDemoLogin();
        seedIshitaLogin();
        ifstream li(likesFile);
        if(li) { try { json data; li>>data; for(const auto& x:data) {
            int from=x.value("from",0),to=x.value("to",0);
            for(auto& u:accounts) if(u.id==from) u.liked.insert(to);
        }} catch(...) {} }
    }
    User registerUser(const string& name,const string& email,const string& password) {
        lock_guard<mutex> g(mtx);
        for(const auto& u:accounts) if(u.email==email) throw runtime_error("Email already registered.");
        int id=3; for(const auto& u:accounts) id=max(id,u.id+1);
        User u; u.id=id; u.name=name; u.email=email; u.password=password; accounts.push_back(u); saveAccounts(); return u;
    }
    User authenticate(const string& email,const string& password) const {
        lock_guard<mutex> g(mtx);
        for(const auto& u:accounts) if(u.email==email && u.password==password) return u;
        throw runtime_error("Incorrect email or password. Demo: aarav@example.com / demo123");
    }
    User getUser(int id) const {
        lock_guard<mutex> g(mtx);
        for(const auto& u:accounts) if(u.id==id) return u;
        throw runtime_error("User not found.");
    }
    void updateProfile(int id,const string& bio,const Preferences& p) {
        lock_guard<mutex> g(mtx);
        for(auto& u:accounts) if(u.id==id) {u.bio=bio;u.preferences=p;u.hasProfile=true;saveAccounts();return;}
        throw runtime_error("User not found.");
    }
    vector<User> candidates(int currentId) const {
        lock_guard<mutex> g(mtx);
        vector<User> out=demoProfiles;
        for(const auto& u:accounts) if(u.id!=currentId && u.hasProfile) out.push_back(u);
        return out;
    }
    bool like(int from,int to) {
        lock_guard<mutex> g(mtx);
        bool target=false; for(const auto& u:demoProfiles) if(u.id==to) target=true;
        for(const auto& u:accounts) if(u.id==to) target=true;
        if(!target || from==to) throw runtime_error("Invalid profile.");
        for(auto& u:accounts) if(u.id==from) {u.liked.insert(to);saveAccounts();saveLikes();return true;}
        throw runtime_error("User not found.");
    }
    vector<User> mutualMatches(int id) const {
        // The Matches tab represents profiles saved by the current user.
        // Demo profiles are read-only, so they cannot send reciprocal likes.
        lock_guard<mutex> g(mtx); vector<User> out;
        set<int> mine;
        for(const auto& u:accounts) if(u.id==id) mine=u.liked;
        for(const auto& candidate:demoProfiles) if(mine.count(candidate.id)) out.push_back(candidate);
        for(const auto& u:accounts) if(u.id!=id && mine.count(u.id)) out.push_back(u);
        return out;
    }
};

class IMatchingStrategy {
public: virtual double calculate(const Preferences&,const Preferences&) const=0; virtual ~IMatchingStrategy()=default;
};
class WeightedMatchingStrategy : public IMatchingStrategy {
    static int minutes(const string& t) { int h=0,m=0; char c=':'; stringstream s(t); s>>h>>c>>m; return h*60+m; }
    static double timeScore(const string& a,const string& b) {
        int d=abs(minutes(a)-minutes(b)); d=min(d,1440-d); return max(0.0,100.0-d/240.0*100.0);
    }
    static double exact(const string& a,const string& b) { return a==b?100.0:0.0; }
    static double budgetScore(int a,int b) {
        if(a<=0||b<=0)return 0; return max(0.0,100.0*(1.0-abs(a-b)/static_cast<double>(max(a,b))));
    }
    static double keywordScore(const vector<string>& a,const vector<string>& b) {
        set<string>x(a.begin(),a.end()),y(b.begin(),b.end()),all=x; all.insert(y.begin(),y.end());
        if(all.empty())return 100; int n=0; for(const auto& k:x)if(y.count(k))++n; return 100.0*n/all.size();
    }
public:
    double calculate(const Preferences& a,const Preferences& b) const override {
        double s=0;
        s+=timeScore(a.sleepTime,b.sleepTime)*.18;
        s+=timeScore(a.wakeTime,b.wakeTime)*.07;
        s+=exact(a.cleanliness,b.cleanliness)*.14;
        s+=exact(a.socialLifestyle,b.socialLifestyle)*.17;
        s+=exact(a.smoking,b.smoking)*.08;
        s+=exact(a.foodPreference,b.foodPreference)*.06;
        s+=exact(a.guests,b.guests)*.06;
        s+=budgetScore(a.budget,b.budget)*.10;
        s+=keywordScore(a.keywords,b.keywords)*.06;
        s+=exact(a.studyWork,b.studyWork)*.04;
        s+=exact(a.roomSharing,b.roomSharing)*.02;
        s+=exact(a.city,b.city)*.02; // location contributes, but does not hide other cities
        return min(100.0,max(0.0,s));
    }
};

class MatchService {
    const UserRepository& repo; const IMatchingStrategy& strategy;
public:
    MatchService(const UserRepository& r,const IMatchingStrategy& s):repo(r),strategy(s){}
    json discover(int id) const {
        User me=repo.getUser(id);
        if(!me.hasProfile) throw runtime_error("Please complete your questionnaire first.");
        json result=json::array();
        for(const auto& other:repo.candidates(id)) {
            json row=other.publicJson();
            row["compatibility"]=static_cast<int>(round(strategy.calculate(me.preferences,other.preferences)));
            row["alreadyLiked"]=me.liked.count(other.id)>0;
            result.push_back(row);
        }
        // City is the first matching priority: same-city profiles always appear first.
        // Within each city-priority group, rank by the existing lifestyle compatibility score.
        const string preferredCity = me.preferences.city;
        sort(result.begin(),result.end(),[&preferredCity](const json& a,const json& b) {
            const string cityA = a["preferences"].value("city","");
            const string cityB = b["preferences"].value("city","");
            const bool sameA = cityA == preferredCity;
            const bool sameB = cityB == preferredCity;
            if(sameA != sameB) return sameA;
            int sa=a.value("compatibility",0), sb=b.value("compatibility",0);
            if(sa!=sb) return sa>sb;
            return a.value("name","")<b.value("name","");
        });
        return result;
    }
};

static string lower(string s) { transform(s.begin(),s.end(),s.begin(),[](unsigned char c){return static_cast<char>(tolower(c));});return s; }
static bool validEmail(const string& e) { auto a=e.find('@'); auto d=e.find('.',a==string::npos?0:a);return a!=string::npos&&d!=string::npos&&d>a+1&&d+1<e.size(); }
static void send(httplib::Response& r,const json& j,int status=200) {r.status=status;r.set_content(j.dump(),"application/json; charset=utf-8");}

int main() {
    try {
        UserRepository repo;
        WeightedMatchingStrategy strategy;
        MatchService matcher(repo,strategy);
        httplib::Server server;

        // Serve only the three frontend files from this simple project folder.
        auto serveFile = [](const string& path, const string& contentType,
                            httplib::Response& res) {
            ifstream file(path, ios::binary);
            if (!file) { res.status = 404; res.set_content("File not found: " + path, "text/plain"); return; }
            ostringstream buffer; buffer << file.rdbuf();
            res.set_content(buffer.str(), contentType);
        };
        server.Get("/", [&](const httplib::Request&, httplib::Response& res) {
            serveFile("index.html", "text/html; charset=utf-8", res);
        });
        server.Get("/index.html", [&](const httplib::Request&, httplib::Response& res) {
            serveFile("index.html", "text/html; charset=utf-8", res);
        });
        server.Get("/styles.css", [&](const httplib::Request&, httplib::Response& res) {
            serveFile("styles.css", "text/css; charset=utf-8", res);
        });
        server.Get("/app.js", [&](const httplib::Request&, httplib::Response& res) {
            serveFile("app.js", "application/javascript; charset=utf-8", res);
        });
        server.Get("/api/health",[](const httplib::Request&,httplib::Response& r){send(r,{{"status","ok"},{"database","local JSON"},{"demoProfiles",100}});});
        server.Post("/api/register",[&](const httplib::Request& q,httplib::Response& r){
            try {json b=json::parse(q.body);string n=b.value("name",""),e=lower(b.value("email","")),p=b.value("password","");
                if(n.empty()||!validEmail(e)||p.size()<6)throw runtime_error("Enter your name, valid email and password (at least 6 characters).");
                User u=repo.registerUser(n,e,p);send(r,{{"message","Account created"},{"user",u.publicJson()}},201);
            }catch(const exception& e){send(r,{{"error",e.what()}},400);}
        });
        server.Post("/api/login",[&](const httplib::Request& q,httplib::Response& r){
            try {json b=json::parse(q.body);User u=repo.authenticate(lower(b.value("email","")),b.value("password",""));send(r,{{"user",u.publicJson()}});}
            catch(const exception& e){send(r,{{"error",e.what()}},401);}
        });
        server.Get(R"(/api/users/([0-9]+)/profile)",[&](const httplib::Request& q,httplib::Response& r){
            try {send(r,{{"user",repo.getUser(stoi(q.matches[1])).publicJson()}});}catch(const exception& e){send(r,{{"error",e.what()}},404);}
        });
        server.Put(R"(/api/users/([0-9]+)/profile)",[&](const httplib::Request& q,httplib::Response& r){
            try {int id=stoi(q.matches[1]);json b=json::parse(q.body);if(!b.contains("preferences"))throw runtime_error("Preferences are required.");
                Preferences p=Preferences::fromJson(b["preferences"]);if(p.city.empty()||p.budget<=0)throw runtime_error("Enter a valid city and budget.");
                repo.updateProfile(id,b.value("bio",""),p);send(r,{{"message","Profile saved locally."}});
            }catch(const exception& e){send(r,{{"error",e.what()}},400);}
        });
        server.Get(R"(/api/users/([0-9]+)/discover)",[&](const httplib::Request& q,httplib::Response& r){
            try {send(r,{{"matches",matcher.discover(stoi(q.matches[1]))}});}catch(const exception& e){send(r,{{"error",e.what()}},400);}
        });
        server.Get(R"(/api/users/([0-9]+)/users/([0-9]+))",[&](const httplib::Request& q,httplib::Response& r){
            try {int id=stoi(q.matches[2]);json rows=matcher.discover(stoi(q.matches[1]));for(const auto& row:rows)if(row.value("id",0)==id){send(r,{{"user",row}});return;}throw runtime_error("Profile not found.");}
            catch(const exception& e){send(r,{{"error",e.what()}},404);}
        });
        server.Post(R"(/api/users/([0-9]+)/like/([0-9]+))",[&](const httplib::Request& q,httplib::Response& r){
            try {repo.like(stoi(q.matches[1]),stoi(q.matches[2]));send(r,{{"message","Like saved locally."},{"mutualMatch",false}});}
            catch(const exception& e){send(r,{{"error",e.what()}},400);}
        });
        server.Get(R"(/api/users/([0-9]+)/matches)",[&](const httplib::Request& q,httplib::Response& r){
            try {json a=json::array();for(const auto& u:repo.mutualMatches(stoi(q.matches[1])))a.push_back(u.publicJson());send(r,{{"matches",a}});}
            catch(const exception& e){send(r,{{"error",e.what()}},400);}
        });
        const char* portEnv = std::getenv("PORT");
int port = portEnv ? std::stoi(portEnv) : 8080;

cout << "FlatMate server running on port "
     << port << endl;

if (!server.listen("0.0.0.0", port)) {
    cerr << "Could not start FlatMate server." << endl;
    return 1;
}
    return 0;
}
