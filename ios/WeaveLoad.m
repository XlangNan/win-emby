// 应用启动后唤起 Swift 端的 WeaveBoot（不改 Tauri 生成的 main.mm，也不用知道 Swift 模块名）
#import <UIKit/UIKit.h>

@interface WeaveLoader : NSObject
@end

@implementation WeaveLoader
+ (void)load {
  [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                    object:nil
                                                     queue:[NSOperationQueue mainQueue]
                                                usingBlock:^(NSNotification *note) {
    Class c = NSClassFromString(@"WeaveBoot");
    SEL sel = NSSelectorFromString(@"attach");
    if (c && [c respondsToSelector:sel]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
      [c performSelector:sel];
#pragma clang diagnostic pop
    } else {
      NSLog(@"[Weave] 找不到 WeaveBoot（Swift 文件没编进去？）");
    }
  }];
}
@end
