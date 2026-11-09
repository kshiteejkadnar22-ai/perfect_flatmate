#include <algorithm>
#include <cmath>
#include <set>
#include <sstream>
#include <string>
#include <vector>
#include "nlohmann/json.hpp"
#include <emscripten/bind.h>

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
};

class IMatchingStrategy {
public:
    virtual double calculate(const Preferences&, const Preferences&) const = 0;
    virtual ~IMatchingStrategy() = default;
};
class WeightedMatchingStrategy : public IMatchingStrategy {
    static int minutes(const string& t) {
        int h=0,m=0; char c=':'; stringstream s(t); s>>h>>c>>m; return h*60+m;
    }
    static double timeScore(const string& a,const string& b) {
        int d=abs(minutes(a)-minutes(b)); d=min(d,1440-d);
        return max(0.0,100.0-d/240.0*100.0);
    }
    static double exact(const string& a,const string& b) { return a==b?100.0:0.0; }
    static double budgetScore(int a,int b) {
        if(a<=0||b<=0)return 0;
        return max(0.0,100.0*(1.0-abs(a-b)/static_cast<double>(max(a,b))));
    }
    static double keywordScore(const vector<string>& a,const vector<string>& b) {
        set<string>x(a.begin(),a.end()),y(b.begin(),b.end()),all=x; all.insert(y.begin(),y.end());
        if(all.empty())return 100;
        int n=0; for(const auto& k:x)if(y.count(k))++n;
        return 100.0*n/all.size();
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
        s+=exact(a.city,b.city)*.02;
        return min(100.0,max(0.0,s));
    }
};
class MatchService {
    const IMatchingStrategy& strategy;
public:
    explicit MatchService(const IMatchingStrategy& s):strategy(s){}
    string rank(const string& ownJson,const string& candidatesJson) const {
        Preferences mine=Preferences::fromJson(json::parse(ownJson));
        json rows=json::parse(candidatesJson);
        for(auto& row:rows) {
            Preferences other=Preferences::fromJson(row.at("preferences"));
            row["compatibility"]=static_cast<int>(round(strategy.calculate(mine,other)));
        }
        const string preferredCity=mine.city;
        sort(rows.begin(),rows.end(),[&](const json& a,const json& b) {
            string cityA=a["preferences"].value("city","");
            string cityB=b["preferences"].value("city","");
            bool sameA=cityA==preferredCity, sameB=cityB==preferredCity;
            if(sameA!=sameB)return sameA;
            int sa=a.value("compatibility",0), sb=b.value("compatibility",0);
            if(sa!=sb)return sa>sb;
            return a.value("name","")<b.value("name","");
        });
        return rows.dump();
    }
};
string rankMatches(const string& mine,const string& candidates) {
    static WeightedMatchingStrategy strategy;
    static MatchService service(strategy);
    return service.rank(mine,candidates);
}
EMSCRIPTEN_BINDINGS(flatmate_matching) {
    emscripten::function("rankMatches",&rankMatches);
}
